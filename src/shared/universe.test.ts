import { describe, expect, it } from "vitest";
import { addRevenueFrame, buildUniverse, companyRecord, parseHoldingsCsv, parseSecTickers, parseWikipediaConstituents, type Revenue } from "./universe";

// The layout of an iShares holdings download: summary lines, a header row,
// quoted holdings (numbers with thousands separators), then a disclaimer.
const IVV = `iShares Core S&P 500 ETF
Fund Holdings as of,"Oct 28, 2026"
Inception Date,"May 15, 2000"
Shares Outstanding,"1,040,000,000.00"
Stock,"-"
Bond,"-"
Cash,"-"
Other,"-"

Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Quantity,Price,Location,Exchange,Currency,FX Rate,Market Currency,Accrual Date
"AAPL","APPLE INC","Information Technology","Equity","45,123,456,789.00","6.81","45,123,456,789.00","180,000,000.00","250.10","United States","NASDAQ","USD","1.00","USD","-"
"GOOGL","ALPHABET INC CLASS A","Communication","Equity","20,000,000.00","2.10","20,000,000.00","100,000.00","200.00","United States","NASDAQ","USD","1.00","USD","-"
"GOOG","ALPHABET INC CLASS C","Communication","Equity","17,000,000.00","1.70","17,000,000.00","85,000.00","200.00","United States","NASDAQ","USD","1.00","USD","-"
"BRKB","BERKSHIRE HATHAWAY INC CLASS B","Financials","Equity","10,000,000.00","1.60","10,000,000.00","20,000.00","500.00","United States","New York Stock Exchange Inc.","USD","1.00","USD","-"
"CL","COLGATE-PALMOLIVE","Consumer Staples","Equity","3,000,000.00","0.15","3,000,000.00","40,000.00","75.00","United States","New York Stock Exchange Inc.","USD","1.00","USD","-"
"ZZZZ","DELISTED HOLDING","Industrials","Equity","1,000.00","0.00","1,000.00","10.00","100.00","United States","-","USD","1.00","USD","-"
"USD","USD CASH","Cash and/or Derivatives","Cash","500,000.00","0.05","500,000.00","500,000.00","100.00","United States","-","USD","1.00","USD","-"
"ESZ6","S&P500 EMINI DEC 26","Cash and/or Derivatives","Futures","0.00","0.00","9,000,000.00","30.00","6,000.00","United States","Chicago Mercantile Exchange","USD","1.00","USD","-"

"The content contained herein is owned or licensed by BlackRock and/or its third-party information providers."`;

const SEC_TICKERS = {
  0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
  1: { cik_str: 1652044, ticker: "GOOGL", title: "Alphabet Inc." },
  2: { cik_str: 1652044, ticker: "GOOG", title: "Alphabet Inc." },
  3: { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE HATHAWAY INC" },
  4: { cik_str: 21665, ticker: "CL", title: "COLGATE PALMOLIVE CO" },
};

describe("parseHoldingsCsv", () => {
  it("reads the as-of date and equity holdings, mapping sector names to GICS", () => {
    const { asOf, holdings } = parseHoldingsCsv(IVV);
    expect(asOf).toBe("2026-10-28");
    expect(holdings.map((h) => h.ticker)).toEqual(["AAPL", "GOOGL", "GOOG", "BRKB", "CL", "ZZZZ"]); // no cash or futures
    expect(holdings[1]).toEqual({ ticker: "GOOGL", name: "ALPHABET INC CLASS A", sector: "Communication Services" });
  });

  it("explains a file that isn't an iShares holdings download", () => {
    expect(() => parseHoldingsCsv("<html>Access denied</html>")).toThrow(/iShares holdings file/);
  });
});

describe("buildUniverse", () => {
  it("matches holdings to CIKs across ticker styles, one row per company, with revenue", () => {
    const revenue = new Map<string, Revenue>();
    addRevenueFrame(revenue, { data: [{ cik: 21665, end: "2024-12-31", val: 20101e6 }] }, "Revenues");
    addRevenueFrame(revenue, { data: [{ cik: 21665, end: "2025-12-31", val: 20382e6 }, { cik: 320193, end: "2025-09-27", val: 416e9 }] }, "RevenueFromContractWithCustomerExcludingAssessedTax");

    const { rows, unmatched } = buildUniverse([{ index: "S&P 500", ...parseHoldingsCsv(IVV) }], parseSecTickers(SEC_TICKERS), revenue);

    expect(rows.map((r) => r.ticker)).toEqual(["AAPL", "GOOGL", "BRK-B", "CL"]);
    expect(rows.find((r) => r.ticker === "CL")).toEqual({
      cik: "0000021665",
      ticker: "CL",
      name: "COLGATE PALMOLIVE CO",
      gicsSector: "Consumer Staples",
      index: "S&P 500",
      revenueUsd: 20382e6,
      revenueFiscalYearEnd: "2025-12-31",
      revenueTag: "RevenueFromContractWithCustomerExcludingAssessedTax",
    });
    expect(rows.find((r) => r.ticker === "BRK-B")?.revenueUsd).toBeUndefined();
    expect(unmatched).toEqual([{ ticker: "ZZZZ", name: "DELISTED HOLDING", sector: "Industrials", index: "S&P 500" }]);
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
    const row = { cik: "0000021665", ticker: "CL", name: "Colgate", gicsSector: "Consumer Staples", index: "S&P 500" as const };
    expect(companyRecord(row, "2026-11-02T11:17:00Z")).toMatchObject({
      industry: "Consumer Staples",
      index_membership: "S&P 500",
      revenue_usd: null,
      in_index: true,
      indexed_at: "2026-11-02T11:17:00Z",
    });
  });
});
