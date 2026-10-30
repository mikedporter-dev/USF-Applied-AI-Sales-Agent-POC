import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResearchEvent } from "../src/shared/research";
import type { Env } from "./env";
import { isValidTicker, keyItems, MAX_TURNS, runResearch, WRAP_UP_TURNS } from "./research";

const NOW = new Date("2026-10-29T12:00:00Z");
const TENK_URL = "https://www.sec.gov/Archives/edgar/data/1/0000000001-26-000001.txt";
const EIGHTK_URL = "https://www.sec.gov/Archives/edgar/data/1/0000000001-26-000002.txt";

const env = {
  NVIDIA_BASE_URL: "https://nvidia.test/v1",
  NVIDIA_MODEL: "nvidia/nemotron-3.5-lightning-30b-a3b",
  NVIDIA_API_KEY: "nvapi-test",
  MASSIVE_BASE_URL: "https://massive.test",
  MASSIVE_API_KEY: "massive-test",
} as Env;

const massive: Record<string, unknown> = {
  "/v3/reference/tickers/TEST": {
    results: { ticker: "TEST", name: "Test Corp", cik: "0000000001", sic_code: "6311", sic_description: "LIFE INSURANCE", total_employees: 20000 },
  },
  "/stocks/filings/10-K/vX/sections": {
    results: [
      {
        section: "business",
        filing_date: "2026-02-20",
        filing_url: TENK_URL,
        text: "Our 2030 plan commits $250 million to artificial intelligence across claims processing. Other text follows.",
      },
      {
        section: "risk_factors",
        filing_date: "2026-02-20",
        filing_url: TENK_URL,
        text: "Competitors' use of artificial intelligence may reduce demand for our products.",
      },
    ],
  },
  "/stocks/filings/8-K/vX/text": {
    results: [
      {
        accession_number: "0000000001-26-000002",
        form_type: "8-K",
        filing_date: "2026-06-01",
        filing_url: EIGHTK_URL,
        items_text: "Item 5.02. Departure of Directors or Certain Officers.\nThe Board appointed Jane Roe as Chief Data Officer.",
      },
    ],
  },
};

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
const turn = (...tool_calls: ReturnType<typeof toolCall>[]) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls } }] }));

function mockFetch(script: (() => Response)[]) {
  const nvidiaBodies: { messages: { role: string; content: string | null }[]; tools: { function: { name: string } }[] }[] = [];
  let step = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === "nvidia.test") {
      nvidiaBodies.push(JSON.parse(String(init?.body)));
      return (script[step++] ?? (() => turn(toolCall(`x${step}`, "list_8k_filings", {}))))();
    }
    const body = massive[url.pathname];
    return body ? new Response(JSON.stringify(body)) : new Response("not found", { status: 404 });
  });
  return nvidiaBodies;
}

async function collect(script: (() => Response)[]) {
  const nvidiaBodies = mockFetch(script);
  const events: ResearchEvent[] = [];
  const result = await runResearch(env, "TEST", async (e) => void events.push(e), NOW);
  return { events, result, nvidiaBodies };
}

afterEach(() => vi.unstubAllGlobals());

describe("runResearch", () => {
  it("runs tools, keeps quoted evidence, rejects invented quotes, and scores the result", async () => {
    const { events, result, nvidiaBodies } = await collect([
      () => turn(toolCall("a", "list_8k_filings", {}), toolCall("b", "search_10k", { section: "business", terms: ["artificial intelligence"] })),
      () => turn(toolCall("c", "read_8k", { accession: "0000000001-26-000002" })),
      () =>
        turn(
          toolCall("d", "record_signal", {
            kind: "ai_commitment",
            summary: "Commits $250 million to AI in claims.",
            form: "10-K",
            section: "Item 1 Business",
            filed_at: "2026-02-20",
            url: TENK_URL,
            quote: "commits $250 million to artificial intelligence",
          }),
          toolCall("e", "record_signal", {
            kind: "ai_scaled_results",
            summary: "Claims AI cut costs 40%.",
            form: "10-K",
            filed_at: "2026-02-20",
            url: TENK_URL,
            quote: "AI cut claims costs by 40 percent last year",
          }),
          toolCall("f", "record_signal", {
            kind: "leadership_change",
            summary: "New Chief Data Officer appointed.",
            form: "8-K",
            section: "Item 5.02",
            filed_at: "2026-06-01",
            url: EIGHTK_URL,
            quote: "appointed Jane Roe as Chief Data Officer",
          }),
        ),
      () => turn(toolCall("h", "finish", { summary: "One AI commitment and a new CDO." })),
    ]);

    expect(result.stopReason).toBe("finished");
    expect(result.summary).toBe("One AI commitment and a new CDO.");
    expect(result.signals.map((s) => s.kind)).toEqual(["ai_commitment", "leadership_change"]);
    expect(result.signals.every((s) => s.source === "massive")).toBe(true);
    expect(result.demoted).toBe(false); // the invented "scaled results" signal was rejected
    expect(result.company.industry).toBe("Financials");
    expect(result.scores.intent).toBe(45);
    expect(result.whyNow?.kind).toBe("leadership_change");

    const rejected = events.filter((e) => e.type === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ tool: "record_signal", reason: expect.stringContaining("not found") });
    expect(events.at(-1)?.type).toBe("result");

    // Tool results are sent back to the model, matched to each call.
    const lastRequest = nvidiaBodies.at(-1)!;
    expect(lastRequest.messages.filter((m) => m.role === "tool")).toHaveLength(6);
    // Without SEC_USER_AGENT, EDGAR tools aren't offered.
    expect(lastRequest.tools.map((t) => t.function.name)).not.toContain("read_edgar_document");
  });

  it("reminds the agent near the limit, then gives a record-only wrap-up", async () => {
    const { result, nvidiaBodies, events } = await collect([]);
    expect(result.stopReason).toBe("step_limit");
    expect(nvidiaBodies).toHaveLength(MAX_TURNS + WRAP_UP_TURNS);

    const userText = (i: number) => nvidiaBodies[i].messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    expect(userText(MAX_TURNS - 1)).toContain("1 turn left");
    expect(userText(MAX_TURNS)).toContain("Research time is up");

    // Wrap-up turns only offer the recording tools, and refuse anything else.
    expect(nvidiaBodies[MAX_TURNS].tools.map((t) => t.function.name).sort()).toEqual(["finish", "record_signal"]);
    const lastToolResult = nvidiaBodies.at(-1)!.messages.filter((m) => m.role === "tool").at(-1)!;
    expect(lastToolResult.content).toContain("only record_signal");
    expect(events).toContainEqual(expect.objectContaining({ type: "rejected", tool: "list_8k_filings", reason: expect.stringContaining("time is up") }));
    expect(events.filter((e) => e.type === "status" && e.message.startsWith("Wrapping up"))).toHaveLength(WRAP_UP_TURNS);
  });

  it("finishes during wrap-up and keeps what it records there", async () => {
    const script = Array.from({ length: MAX_TURNS }, (_, i) => () => turn(toolCall(`s${i}`, "search_10k", { section: "business", terms: ["artificial intelligence"] })));
    script.push(() =>
      turn(
        toolCall("w1", "record_signal", {
          kind: "ai_commitment",
          summary: "Commits $250 million to AI in claims.",
          form: "10-K",
          filed_at: "2026-02-20",
          url: TENK_URL,
          quote: "commits $250 million to artificial intelligence",
        }),
        toolCall("w2", "finish", { summary: "" }),
      ),
    );
    const { result, nvidiaBodies, events } = await collect(script);
    expect(result.stopReason).toBe("finished");
    expect(result.signals).toHaveLength(1);
    expect(nvidiaBodies).toHaveLength(MAX_TURNS + 1);
    // Repeats of the same search are skipped after the first.
    expect(events.filter((e) => e.type === "tool" && e.detail.includes("repeat search skipped"))).toHaveLength(MAX_TURNS - 1);
  });

  it("reminds the agent once about a key 8-K it recorded nothing from, then lets it finish", async () => {
    const { result, nvidiaBodies, events } = await collect([
      () => turn(toolCall("a", "finish", { summary: "Nothing found." })),
      () => turn(toolCall("b", "finish", { summary: "The officer change doesn't qualify." })),
    ]);
    const firstReply = nvidiaBodies[1].messages.filter((m) => m.role === "tool").at(-1)!.content ?? "";
    expect(firstReply).toContain("2026-06-01 (accession 0000000001-26-000002): Item 5.02 officer change");
    expect(events).toContainEqual(expect.objectContaining({ type: "status", message: expect.stringContaining("Coverage check: 1 key 8-K") }));
    expect(result.stopReason).toBe("finished");
    expect(result.summary).toBe("The officer change doesn't qualify.");
    expect(nvidiaBodies).toHaveLength(2);
  });

  it("offers EDGAR tools when SEC_USER_AGENT is set", async () => {
    const nvidiaBodies = mockFetch([() => turn(toolCall("a", "finish", { summary: "done" }))]);
    await runResearch({ ...env, SEC_USER_AGENT: "Test Dev test@example.com" }, "TEST", async () => {}, NOW);
    expect(nvidiaBodies[0].tools.map((t) => t.function.name)).toContain("read_edgar_document");
  });
});

describe("tool argument handling", () => {
  it("explains a missing accession instead of calling SEC with it", async () => {
    const { nvidiaBodies } = await collect([
      () => turn(toolCall("a", "read_8k", {}), toolCall("b", "read_8k", { accession_number: "0000000001-26-000002" })),
      () => turn(toolCall("c", "finish", { summary: "done" })),
    ]);
    const toolResults = nvidiaBodies[1].messages.filter((m) => m.role === "tool").map((m) => m.content ?? "");
    expect(toolResults[0]).toContain("accession is required");
    expect(toolResults[1]).toContain("Jane Roe"); // accession_number accepted
  });
});

describe("company facts", () => {
  it("fills sector from the SIC code and revenue from SEC XBRL, not from the agent", async () => {
    const xbrl = "/api/xbrl/companyconcept/CIK0000000001/us-gaap/Revenues.json";
    massive[xbrl] = { units: { USD: [{ start: "2025-01-01", end: "2025-12-31", val: 5.2e9, form: "10-K", filed: "2026-02-20" }] } };
    try {
      const nvidiaBodies = mockFetch([() => turn(toolCall("a", "finish", { summary: "done" }))]);
      const result = await runResearch({ ...env, SEC_USER_AGENT: "Test Dev test@example.com" }, "TEST", async () => {}, NOW);
      expect(result.company.industry).toBe("Financials");
      expect(result.company.revenueUsd).toBe(5.2e9);
      expect(result.facts?.sectorSource).toContain("SIC 6311");
      expect(result.facts?.revenueSource).toContain("fiscal year ended 2025-12-31");
      expect(nvidiaBodies[0].messages.find((m) => m.role === "user")?.content).toContain("Financials (from SIC code) · revenue $5.2B");
      expect(nvidiaBodies[0].tools.map((t) => t.function.name)).not.toContain("set_company_facts");
    } finally {
      delete massive[xbrl];
    }
  });

  it("leaves revenue empty without SEC access", async () => {
    mockFetch([() => turn(toolCall("a", "finish", { summary: "done" }))]);
    const result = await runResearch(env, "TEST", async () => {}, NOW);
    expect(result.company.industry).toBe("Financials");
    expect(result.company.revenueUsd).toBeUndefined();
  });
});

describe("key 8-K items", () => {
  it("come with the filing list, so the agent can record them without reading each 8-K", async () => {
    const { result, nvidiaBodies, events } = await collect([
      () => turn(toolCall("a", "list_8k_filings", {})),
      () =>
        turn(
          toolCall("b", "record_signal", {
            kind: "leadership_change",
            summary: "New Chief Data Officer appointed.",
            form: "8-K",
            filed_at: "2026-06-01",
            url: EIGHTK_URL,
            quote: "appointed Jane Roe as Chief Data Officer",
          }),
          toolCall("c", "finish", { summary: "A new CDO." }),
        ),
    ]);
    const listing = JSON.parse(nvidiaBodies[1].messages.filter((m) => m.role === "tool").at(-1)!.content!);
    expect(listing[0].key_items[0]).toMatchObject({ item: "5.02", signal: "officer change" });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool", detail: "1 8-K filings, 1 with key items" }));
    expect(result.signals).toHaveLength(1);
    expect(result.stopReason).toBe("finished"); // covered, so no coverage reminder
  });

  it("splits on item headings, not on references to items inside the text", () => {
    const text = "Item 2.02. Results.\nThe information in Item 2.05 of this report is furnished.\nItem 2.05. Costs Associated with Exit.\nThe Board approved an expansion.\nItem 9.01. Exhibits.";
    expect(keyItems(text)).toEqual([{ item: "2.05", text: "Item 2.05. Costs Associated with Exit.\nThe Board approved an expansion." }]);
  });

  it("are named in the reminder near the turn limit until something is recorded from them", async () => {
    const { nvidiaBodies } = await collect([]);
    const reminder = nvidiaBodies[MAX_TURNS - 1].messages.filter((m) => m.role === "user").at(-1)!.content ?? "";
    expect(reminder).toContain("Key 8-Ks with nothing recorded yet");
    expect(reminder).toContain("Item 5.02 officer change");
  });
});

describe("AI mentions", () => {
  it("can't come from risk-factor boilerplate", async () => {
    const { result, events } = await collect([
      () => turn(toolCall("a", "search_10k", { section: "risk_factors", terms: ["artificial intelligence"] })),
      () =>
        turn(
          toolCall("b", "record_signal", {
            kind: "ai_mention",
            summary: "Mentions competitors' use of AI.",
            form: "10-K",
            filed_at: "2026-02-20",
            url: TENK_URL,
            quote: "Competitors' use of artificial intelligence may reduce demand",
          }),
        ),
    ]);
    expect(result.signals).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "rejected", reason: expect.stringContaining("Risk-factor language") }));
  });
});

describe("isValidTicker", () => {
  it.each(["CL", "BRK.B", "BF-B"])("accepts %s", (t) => expect(isValidTicker(t)).toBe(true));
  it.each(["", "cl", "TOOLONGTICKER", "CL;DROP", 42])("rejects %j", (t) => expect(isValidTicker(t)).toBe(false));
});
