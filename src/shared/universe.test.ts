import { describe, expect, it } from "vitest";
import { addRevenueFrame, buildUniverse, companyRecord, parseSecTickers, parseWikipediaConstituents, type Revenue } from "./universe";

// Companies as the Wikipedia lists give them: two share classes of one company,
// a ticker with a class suffix, and one with no SEC match.
const SP500 = [
  { ticker: "AAPL", name: "Apple Inc.", sector: "Information Technology" },
  { ticker: "GOOGL", name: "Alphabet Inc. (Class A)", sector: "Communication Services" },
  { ticker: "GOOG", name: "Alphabet Inc. (Class C)", sector: "Communication Services" },
  { ticker: "BRK.B", name: "Berkshire Hathaway", sector: "Financials" },
  { ticker: "CL", name: "Colgate-Palmolive", sector: "Consumer Staples" },
  { ticker: "ZZZZ", name: "Delisted Co", sector: "Industrials" },
  { ticker: "CWEN.A", name: "Clearway Energy (Class A)", sector: "Utilities" },
];

const SEC_TICKERS = {
  0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
  1: { cik_str: 1652044, ticker: "GOOGL", title: "Alphabet Inc." },
  2: { cik_str: 1652044, ticker: "GOOG", title: "Alphabet Inc." },
  3: { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE HATHAWAY INC" },
  4: { cik_str: 21665, ticker: "CL", title: "COLGATE PALMOLIVE CO" },
  5: { cik_str: 1567683, ticker: "CWEN", title: "Clearway Energy, Inc." },
};

describe("buildUniverse", () => {
  it("matches holdings to CIKs across ticker styles, one row per company, with revenue", () => {
    const revenue = new Map<string, Revenue>();
    addRevenueFrame(revenue, { data: [{ cik: 21665, end: "2024-12-31", val: 20101e6 }] }, "Revenues");
    addRevenueFrame(revenue, { data: [{ cik: 21665, end: "2025-12-31", val: 20382e6 }, { cik: 320193, end: "2025-09-27", val: 416e9 }] }, "RevenueFromContractWithCustomerExcludingAssessedTax");

    const { rows, unmatched } = buildUniverse([{ index: "S&P 500", holdings: SP500 }], parseSecTickers(SEC_TICKERS), revenue);

    expect(rows.map((r) => r.ticker)).toEqual(["AAPL", "GOOGL", "BRK-B", "CL", "CWEN"]);
    expect(rows.find((r) => r.ticker === "GOOGL")?.name).toBe("Alphabet Inc."); // share class dropped
    expect(rows.find((r) => r.ticker === "CL")).toEqual({
      cik: "0000021665",
      ticker: "CL",
      name: "Colgate-Palmolive",
      legalName: "COLGATE PALMOLIVE CO",
      gicsSector: "Consumer Staples",
      index: "S&P 500",
      revenueUsd: 20382e6,
      revenueFiscalYearEnd: "2025-12-31",
      revenueTag: "RevenueFromContractWithCustomerExcludingAssessedTax",
    });
    expect(rows.find((r) => r.ticker === "BRK-B")?.revenueUsd).toBeUndefined();
    expect(unmatched).toEqual([{ ticker: "ZZZZ", name: "Delisted Co", sector: "Industrials", index: "S&P 500" }]);
  });
});

describe("parseWikipediaConstituents", () => {
  // The shape of the rendered constituents table: a lead table without the
  // columns we need, then the list itself, with links and footnote markers.
  const html = `<div class="mw-parser-output"><table class="infobox"><tr><th>Index</th><td>S&amp;P 500</td></tr></table>
<table class="wikitable sortable" id="constituents"><thead><tr><th>Symbol</th><th>Security</th><th>GICS Sector</th><th>GICS Sub-Industry</th><th>CIK</th></tr></thead>
<tbody><tr><td><a rel="nofollow" class="external text" href="https://www.nyse.com/quote/XNYS:MMM">MMM</a></td><td><a href="/wiki/3M" title="3M">3M</a></td><td>Industrials</td><td>Industrial Conglomerates</td><td>0000066740</td></tr>
<tr><td><a href="https://www.nyse.com/quote/XNYS:BRK.B">BRK.B</a></td><td><a href="/wiki/Berkshire_Hathaway">Berkshire Hathaway</a><sup class="reference">[3]</sup></td><td>Financials</td><td>Multi-Sector Holdings</td><td>0001067983</td></tr>
<tr><td><a href="https://www.nyse.com/quote/XNYS:CL">CL</a></td><td>Colgate-Palmolive</td><td>Consumer Staples</td><td>Household Products</td><td>0000021665</td></tr>
</tbody></table></div>`;

  it("reads ticker, name and GICS sector from the constituents table", () => {
    expect(parseWikipediaConstituents(html)).toEqual([
      { ticker: "MMM", name: "3M", sector: "Industrials" },
      { ticker: "BRK.B", name: "Berkshire Hathaway", sector: "Financials" },
      { ticker: "CL", name: "Colgate-Palmolive", sector: "Consumer Staples" },
    ]);
  });

  it("says when the page has no constituents table", () => {
    expect(() => parseWikipediaConstituents("<p>Page moved</p>")).toThrow(/Symbol and GICS Sector/);
  });
});

describe("companyRecord", () => {
  it("maps a row to the companies table, stamped with the import time", () => {
    const row = { cik: "0000021665", ticker: "CL", name: "Colgate-Palmolive", legalName: "COLGATE PALMOLIVE CO", gicsSector: "Consumer Staples", index: "S&P 500" as const };
    expect(companyRecord(row, "2026-11-02T11:17:00Z")).toMatchObject({
      industry: "Consumer Staples",
      index_membership: "S&P 500",
      revenue_usd: null,
      in_index: true,
      indexed_at: "2026-11-02T11:17:00Z",
    });
  });
});
