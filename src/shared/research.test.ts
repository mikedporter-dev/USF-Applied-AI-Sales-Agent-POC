import { describe, expect, it } from "vitest";
import { addToCorpus, type Corpus, findPassages, htmlToText, validateFacts, validateSignal } from "./research";

const NOW = new Date("2026-10-29T12:00:00Z");
const URL_A = "https://www.sec.gov/Archives/edgar/data/1/a.txt";

const URL_B = "https://www.sec.gov/Archives/edgar/data/1/b.htm";

function corpus(): Corpus {
  const c: Corpus = new Map();
  addToCorpus(c, URL_A, "We are “leading in capabilities” such as data,\n analytics and AI across the business.", "massive", "2026-02-23");
  addToCorpus(c, URL_B, "On April 30, 2026, the Board approved an expansion of the program. Charges are now estimated at $350 to $550 million.", "edgar");
  return c;
}

const valid = {
  kind: "ai_commitment",
  summary: "Names AI leadership as a strategic priority.",
  form: "10-K",
  section: "Item 1 Business",
  filed_at: "2026-02-23",
  url: URL_A,
  quote: '"leading in capabilities" such as data, analytics and AI',
};

describe("validateSignal", () => {
  it("accepts a quote that matches ignoring case, curly quotes and line breaks", () => {
    const s = validateSignal(valid, corpus(), NOW);
    expect(typeof s).toBe("object");
    expect(s).toMatchObject({ kind: "ai_commitment", source: "massive", filedAt: "2026-02-23" });
  });

  it.each([
    [{ kind: "ai_vibes" }, "kind"],
    [{ form: "S-1" }, "form"],
    [{ filed_at: "Feb 2026" }, "filed_at"],
    [{ quote: "too short" }, "quote"],
    [{ quote: "we will invest $1 billion in generative AI next year" }, "not found"],
  ])("rejects %j", (change, reason) => {
    const result = validateSignal({ ...valid, ...change }, corpus(), NOW);
    expect(typeof result).toBe("string");
    expect(result).toContain(reason);
  });

  it("takes url, source and filing date from the document the quote is in, not from the agent", () => {
    const s = validateSignal({ ...valid, url: "https://www.sec.gov/made-up.txt", filed_at: "2026-01-01" }, corpus(), NOW);
    expect(s).toMatchObject({ url: URL_A, source: "massive", filedAt: "2026-02-23" });

    const fromB = validateSignal(
      { ...valid, kind: "restructuring", form: "8-K", url: URL_A, filed_at: "2026-05-01", quote: "the Board approved an expansion of the program" },
      corpus(),
      NOW,
    );
    // B has no known filing date, so the agent's date is used; url and source come from B.
    expect(fromB).toMatchObject({ url: URL_B, source: "edgar", filedAt: "2026-05-01" });
  });

  it("rejects evidence from a filing older than the window, using the filing's real date", () => {
    const c = corpus();
    const OLD = "https://www.sec.gov/Archives/edgar/data/1/old.txt";
    addToCorpus(c, OLD, "We are exploring artificial intelligence across our plants.", "massive", "2025-03-05");
    const result = validateSignal({ ...valid, url: OLD, filed_at: "2026-03-05", quote: "exploring artificial intelligence across our plants" }, c, NOW);
    expect(result).toContain("outside");
  });

  it("accepts a quote shortened with an ellipsis when every piece appears in order", () => {
    const quote = "the Board approved an expansion … estimated at $350 to $550 million";
    expect(typeof validateSignal({ ...valid, kind: "restructuring", form: "8-K", quote }, corpus(), NOW)).toBe("object");
    const outOfOrder = "estimated at $350 to $550 million ... the Board approved an expansion";
    expect(typeof validateSignal({ ...valid, quote: outOfOrder }, corpus(), NOW)).toBe("string");
  });

  it("rejects an ellipsis that would stitch together passages far apart", () => {
    const c: Corpus = new Map();
    addToCorpus(c, URL_A, `We will not invest in new AI programs. ${"Unrelated text. ".repeat(200)} We expect strong growth in pet nutrition.`, "massive", "2026-02-23");
    const stitched = "We will not invest in new AI programs ... We expect strong growth in pet nutrition";
    expect(validateSignal({ ...valid, quote: stitched }, c, NOW)).toContain("not found");
  });
});

describe("validateFacts", () => {
  it("accepts a sector alone, or revenue with a quote found in any text read", () => {
    expect(validateFacts({ gics_sector: "Financials" }, corpus())).toEqual({ facts: { gicsSector: "Financials" } });
    const c = corpus();
    addToCorpus(c, URL_A, "Net sales were $20,382 in 2025", "massive");
    const result = validateFacts({ gics_sector: "Consumer Staples", revenue_usd: 20382e6, revenue_quote: "Net sales were $20,382 in 2025" }, c);
    expect(result).toMatchObject({ facts: { revenueUsd: 20382e6, revenueUrl: URL_A } });
  });

  it("rejects an unknown sector, and keeps the sector when only the revenue fails", () => {
    expect(typeof validateFacts({ gics_sector: "Crypto" }, corpus())).toBe("string");
    const result = validateFacts({ gics_sector: "Financials", revenue_usd: 5e9, revenue_quote: "made lots of money", url: URL_A }, corpus());
    expect(result).toMatchObject({ facts: { gicsSector: "Financials" }, revenueError: expect.stringContaining("not found") });
  });
});

describe("findPassages", () => {
  it("returns non-overlapping passages around each match", () => {
    const text = `${"x".repeat(2000)} artificial intelligence ${"y".repeat(2000)} AI pilot ${"z".repeat(100)}`;
    const passages = findPassages(text, ["artificial intelligence", "ai pilot"], 50);
    expect(passages).toHaveLength(2);
    expect(passages[0]).toContain("artificial intelligence");
    expect(passages[1]).toContain("AI pilot");
  });
});

describe("htmlToText", () => {
  it("strips tags and decodes entities into readable text", () => {
    const html = "<html><head><style>p{}</style></head><body><p>Net&nbsp;sales&#8217; grew &amp; we&#x2019;re</p><div>Next</div></body></html>";
    expect(htmlToText(html)).toBe("Net sales’ grew & we’re\nNext");
  });
});
