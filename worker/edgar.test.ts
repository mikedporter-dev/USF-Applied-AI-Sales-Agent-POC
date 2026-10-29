import { afterEach, describe, expect, it, vi } from "vitest";
import { documentText, filingDocuments, recentFilings } from "./edgar";
import type { Env } from "./env";

const env = { SEC_USER_AGENT: "Test Dev test@example.com" } as Env;

afterEach(() => vi.unstubAllGlobals());

function stub(routes: Record<string, unknown>) {
  const requests: { url: string; userAgent: string | null }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, userAgent: new Headers(init?.headers).get("User-Agent") });
    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(typeof body === "string" ? body : JSON.stringify(body));
  });
  return requests;
}

describe("edgar", () => {
  it("lists in-window filings of the requested forms and identifies itself to SEC", async () => {
    const requests = stub({
      "https://data.sec.gov/submissions/CIK0000021665.json": {
        filings: {
          recent: {
            form: ["8-K", "4", "10-Q", "10-Q"],
            filingDate: ["2026-07-31", "2026-07-30", "2026-07-31", "2025-07-25"],
            accessionNumber: ["0000021665-26-000041", "x", "0000021665-26-000040", "0000021665-25-000030"],
            primaryDocument: ["cl-20260731.htm", "x.xml", "cl-20260630.htm", "old.htm"],
          },
        },
      },
    });
    const filings = await recentFilings(env, "21665", ["10-Q", "8-K"], "2025-10-29");
    expect(filings.map((f) => f.form)).toEqual(["8-K", "10-Q"]);
    expect(filings[1].folderUrl).toBe("https://www.sec.gov/Archives/edgar/data/21665/000002166526000040");
    expect(requests[0].userAgent).toBe("Test Dev test@example.com");
  });

  it("lists a filing's documents without index pages", async () => {
    stub({
      "https://www.sec.gov/Archives/edgar/data/21665/000002166526000041/index.json": {
        directory: { item: [{ name: "ex99.htm", size: "51234" }, { name: "0000021665-26-000041-index.htm" }, { name: "R1.xml" }] },
      },
    });
    const docs = await filingDocuments(env, "0000021665", "0000021665-26-000041");
    expect(docs).toEqual([
      { name: "ex99.htm", size: 51234, url: "https://www.sec.gov/Archives/edgar/data/21665/000002166526000041/ex99.htm" },
    ]);
  });

  it("converts HTML documents to text and refuses non-SEC URLs", async () => {
    const url = "https://www.sec.gov/Archives/edgar/data/21665/000002166526000041/ex99.htm";
    stub({ [url]: "<p>Net sales grew 2%</p>" });
    expect(await documentText(env, url)).toBe("Net sales grew 2%");
    await expect(documentText(env, "https://evil.example.com/x.htm")).rejects.toThrow(/Only documents/);
  });

  it("refuses to call SEC without a contact", async () => {
    await expect(recentFilings({} as Env, "1", ["8-K"], "2025-01-01")).rejects.toThrow(/SEC_USER_AGENT/);
  });
});
