import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { passThrough, sourceFor } from "./universe";

afterEach(() => vi.unstubAllGlobals());

describe("sourceFor", () => {
  it("resolves only the fixed sources", () => {
    expect(sourceFor("IVV")?.url).toBe(
      "https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/1467271812596.ajax?fileType=csv&fileName=IVV_holdings&dataType=fund",
    );
    expect(sourceFor("sec-tickers")).toEqual({ url: "https://www.sec.gov/files/company_tickers.json", sec: true });
    expect(sourceFor("revenue/Revenues/2025")?.url).toBe("https://data.sec.gov/api/xbrl/frames/us-gaap/Revenues/USD/CY2025.json");
    expect(sourceFor("revenue/NetIncomeLoss/2025")).toBeUndefined();
    expect(sourceFor("https://evil.example.com")).toBeUndefined();
    expect(sourceFor("SPY")).toBeUndefined();
  });
});

describe("passThrough", () => {
  it("streams the source with the SEC contact for SEC files", async () => {
    let userAgent: string | null = null;
    vi.stubGlobal("fetch", async (_: RequestInfo | URL, init?: RequestInit) => {
      userAgent = new Headers(init?.headers).get("User-Agent");
      return new Response('{"0":{"cik_str":21665,"ticker":"CL","title":"COLGATE PALMOLIVE CO"}}', {
        headers: { "Content-Type": "application/json" },
      });
    });
    const res = await passThrough({ SEC_USER_AGENT: "Test Dev test@example.com" } as Env, "sec-tickers");
    expect(await res.json()).toEqual({ 0: { cik_str: 21665, ticker: "CL", title: "COLGATE PALMOLIVE CO" } });
    expect(userAgent).toBe("Test Dev test@example.com");
  });

  it("refuses SEC files without a contact, unknown sources, and reports upstream failures", async () => {
    expect((await passThrough({} as Env, "sec-tickers")).status).toBe(503);
    expect((await passThrough({} as Env, "other")).status).toBe(404);
    vi.stubGlobal("fetch", async () => new Response("blocked", { status: 403 }));
    const res = await passThrough({} as Env, "IJR");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't fetch IJR (HTTP 403)." });
  });
});
