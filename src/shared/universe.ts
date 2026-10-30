import { htmlToText } from "./research";
import type { IndexMembership } from "./types";

// The S&P Composite 1500 universe: which companies are in each index, matched
// to their SEC CIK, with GICS sector and latest annual revenue. Parsing and
// matching live here so they can be tested; scripts/import-universe.ts runs
// them weekly in GitHub Actions and saves the result to Supabase.

/**
 * The three indexes and the Wikipedia page listing each one's companies with
 * GICS sector. (iShares fund holdings would be the authoritative list, but
 * iShares returned a web page instead of the file to both Cloudflare and GitHub
 * Actions.) `min` guards against a page that was vandalized or restructured.
 */
export const INDEX_SOURCES: { index: IndexMembership; wikipedia: string; min: number }[] = [
  { index: "S&P 500", wikipedia: "List_of_S&P_500_companies", min: 450 },
  { index: "S&P MidCap 400", wikipedia: "List_of_S&P_400_companies", min: 350 },
  { index: "S&P SmallCap 600", wikipedia: "List_of_S&P_600_companies", min: 500 },
];

/** Don't save an import that matched far fewer companies than the 1,500 expected. */
export const MIN_COMPANIES = 1200;

/** XBRL tags for total revenue, and the calendar years to look in, latest first. */
export const REVENUE_TAGS = [
  "Revenues",
  "RevenuesNetOfInterestExpense", // how most banks report revenue
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
] as const;
export const REVENUE_YEARS = (asOf: Date) => [asOf.getUTCFullYear() - 1, asOf.getUTCFullYear() - 2];

export interface Holding {
  ticker: string;
  name: string;
  sector: string;
}

/** Text of each cell in an HTML table row. */
function cells(row: string, tag: "th" | "t[dh]"): string[] {
  return [...row.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) =>
    htmlToText(m[1].replace(/<sup[\s\S]*?<\/sup>/gi, "")) // drop footnote markers like [3]
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * Parse a Wikipedia "List of S&P ... companies" page (rendered HTML from the
 * parse API): the first table with a Symbol column and a GICS Sector column.
 */
export function parseWikipediaConstituents(html: string): Holding[] {
  for (const table of html.split(/<table/i).slice(1).map((t) => t.split(/<\/table>/i)[0])) {
    const rows = table.split(/<tr[\s>]/i).slice(1);
    const header = rows.length ? cells(rows[0], "th").map((h) => h.toLowerCase()) : [];
    const symbol = header.findIndex((h) => /symbol|ticker/.test(h));
    const name = header.findIndex((h) => /^(security|company)/.test(h));
    const sector = header.findIndex((h) => h.startsWith("gics sector"));
    if (symbol < 0 || sector < 0) continue;
    const holdings: Holding[] = [];
    for (const row of rows.slice(1)) {
      const c = cells(row, "t[dh]");
      const ticker = c[symbol]?.toUpperCase();
      if (!ticker || !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) continue;
      holdings.push({ ticker, name: c[name >= 0 ? name : symbol + 1] ?? ticker, sector: c[sector] });
    }
    return holdings;
  }
  throw new Error("No table with Symbol and GICS Sector columns on the Wikipedia page.");
}

/** Compare tickers across sources: Wikipedia writes BRK.B, SEC BRK-B. */
export const tickerKey = (ticker: string) => ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");

export interface SecTicker {
  cik: string;
  ticker: string;
  title: string;
}

/** SEC's company_tickers.json: {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, ...}. */
export function parseSecTickers(data: unknown): Map<string, SecTicker> {
  const out = new Map<string, SecTicker>();
  for (const e of Object.values((data ?? {}) as Record<string, { cik_str: number; ticker: string; title: string }>)) {
    const key = tickerKey(e.ticker);
    if (!out.has(key)) out.set(key, { cik: String(e.cik_str).padStart(10, "0"), ticker: e.ticker, title: e.title });
  }
  return out;
}

export interface Revenue {
  usd: number;
  /** Last day of the fiscal year, YYYY-MM-DD. */
  fiscalYearEnd: string;
  tag: string;
}

/**
 * One SEC XBRL frame (one revenue tag for one calendar year, for every filer):
 * {"data": [{"cik": 21665, "end": "2025-12-31", "val": 20382000000, ...}]}.
 * Adds each company's value to `into`, keeping the latest fiscal year.
 */
export function addRevenueFrame(into: Map<string, Revenue>, data: unknown, tag: string): void {
  for (const d of ((data ?? {}) as { data?: { cik: number; end: string; val: number }[] }).data ?? []) {
    if (!(d.val > 0)) continue;
    const cik = String(d.cik).padStart(10, "0");
    const prev = into.get(cik);
    if (!prev || d.end > prev.fiscalYearEnd) into.set(cik, { usd: d.val, fiscalYearEnd: d.end, tag });
  }
}

export interface UniverseRow {
  cik: string;
  ticker: string;
  /** Common name, from the index list ("Colgate-Palmolive"). */
  name: string;
  /** SEC registrant name ("COLGATE PALMOLIVE CO"). */
  legalName: string;
  gicsSector: string;
  index: IndexMembership;
  revenueUsd?: number;
  revenueFiscalYearEnd?: string;
  revenueTag?: string;
}

export interface UniverseBuild {
  rows: UniverseRow[];
  /** Holdings with no SEC ticker match, to show the seller. */
  unmatched: (Holding & { index: IndexMembership })[];
}

/**
 * Join the holdings to SEC CIKs and revenue. A company with two share classes
 * (GOOGL and GOOG) is one row, under the first ticker listed.
 */
export function buildUniverse(
  holdings: { index: IndexMembership; holdings: Holding[] }[],
  secTickers: Map<string, SecTicker>,
  revenue: Map<string, Revenue>,
): UniverseBuild {
  const rows = new Map<string, UniverseRow>();
  const unmatched: UniverseBuild["unmatched"] = [];
  for (const { index, holdings: list } of holdings) {
    for (const h of list) {
      // A class suffix SEC doesn't list (CWEN.A) falls back to the base ticker (CWEN).
      const sec = secTickers.get(tickerKey(h.ticker)) ?? (h.ticker.includes(".") ? secTickers.get(tickerKey(h.ticker.split(".")[0])) : undefined);
      if (!sec) {
        unmatched.push({ ...h, index });
        continue;
      }
      if (rows.has(sec.cik)) continue;
      const r = revenue.get(sec.cik);
      rows.set(sec.cik, {
        cik: sec.cik,
        ticker: sec.ticker,
        name: h.name.replace(/\s*\((?:class|series) [a-z0-9]+\)$/i, ""), // "Alphabet Inc. (Class A)"
        legalName: sec.title,
        gicsSector: h.sector,
        index,
        revenueUsd: r?.usd,
        revenueFiscalYearEnd: r?.fiscalYearEnd,
        revenueTag: r?.tag,
      });
    }
  }
  return { rows: [...rows.values()], unmatched };
}

/** Rows per Supabase upsert. */
export const SAVE_BATCH = 500;

/**
 * A row for the companies table. Each import stamps its rows with its start
 * time, so rows an earlier import saw but this one didn't can be marked as
 * having left the indexes.
 */
export function companyRecord(r: UniverseRow, importedAt: string) {
  return {
    cik: r.cik,
    ticker: r.ticker,
    name: r.name,
    legal_name: r.legalName,
    industry: r.gicsSector,
    index_membership: r.index,
    revenue_usd: r.revenueUsd ?? null,
    revenue_fiscal_year_end: r.revenueFiscalYearEnd ?? null,
    revenue_source: r.revenueTag ? `SEC XBRL ${r.revenueTag}` : null,
    in_index: true,
    indexed_at: importedAt,
    updated_at: importedAt,
  };
}

export interface UniverseSummary {
  total: number;
  byIndex: Record<IndexMembership, number>;
  withRevenue: number;
  importedAt?: string;
}
