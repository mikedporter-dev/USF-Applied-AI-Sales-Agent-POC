// Weekly S&P Composite 1500 import, run by .github/workflows/import-universe.yml.
//
// Loads every company in the S&P 500, MidCap 400 and SmallCap 600 (from
// Wikipedia's constituent lists) with its GICS sector, SEC CIK and latest annual
// revenue (from SEC), and saves them to Supabase.
// Companies that leave the indexes are kept, marked in_index = false.
//
// Env: SEC_USER_AGENT (required), SUPABASE_URL and SUPABASE_SECRET_KEY (to save).
// With DRY_RUN=true, or without the Supabase variables, it fetches and matches
// everything and prints a report, but saves nothing.

import { createClient } from "@supabase/supabase-js";
import {
  addRevenueFrame,
  buildUniverse,
  companyRecord,
  type Holding,
  INDEX_SOURCES,
  MIN_COMPANIES,
  parseSecTickers,
  parseWikipediaConstituents,
  REVENUE_TAGS,
  REVENUE_YEARS,
  type Revenue,
  SAVE_BATCH,
} from "../src/shared/universe";
import type { IndexMembership } from "../src/shared/types";

const { SEC_USER_AGENT, SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
const DRY_RUN = process.env.DRY_RUN === "true" || !SUPABASE_URL || !SUPABASE_SECRET_KEY;
/** Wikimedia asks API clients to say who they are. */
const APP_AGENT = "Inroad-POC/0.1 (https://github.com/mikedporter-dev/USF-Applied-AI-Sales-Agent-POC)";

async function get(url: string, userAgent: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/** The index's companies from its Wikipedia list, and the page revision they came from. */
async function companiesIn(source: (typeof INDEX_SOURCES)[number]): Promise<{ holdings: Holding[]; revision: number }> {
  const page = encodeURIComponent(source.wikipedia);
  const api = `https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=text|revid&format=json&formatversion=2&redirects=1`;
  const { parse } = (await (await get(api, APP_AGENT)).json()) as { parse?: { text?: string; revid?: number } };
  const holdings = parseWikipediaConstituents(parse?.text ?? "");
  if (holdings.length < source.min) throw new Error(`${source.index}: only ${holdings.length} companies on Wikipedia`);
  return { holdings, revision: parse?.revid ?? 0 };
}

async function main() {
  const importedAt = new Date().toISOString();
  console.log(`S&P Composite 1500 import, ${importedAt}${DRY_RUN ? " (dry run: nothing will be saved)" : ""}`);

  const holdings: { index: IndexMembership; holdings: Holding[] }[] = [];
  for (const source of INDEX_SOURCES) {
    const { holdings: list, revision } = await companiesIn(source);
    console.log(`${source.index}: ${list.length} listings from Wikipedia ${source.wikipedia} (revision ${revision})`);
    holdings.push({ index: source.index, holdings: list });
  }

  if (!SEC_USER_AGENT) throw new Error("SEC_USER_AGENT is required: SEC asks for a name and email on every request.");
  const secTickers = parseSecTickers(await (await get("https://www.sec.gov/files/company_tickers.json", SEC_USER_AGENT)).json());
  console.log(`SEC tickers: ${secTickers.size}`);

  const revenue = new Map<string, Revenue>();
  for (const year of REVENUE_YEARS(new Date())) {
    for (const tag of REVENUE_TAGS) {
      try {
        const frame = await (await get(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/CY${year}.json`, SEC_USER_AGENT)).json();
        addRevenueFrame(revenue, frame, tag);
      } catch (err) {
        console.log(`  SEC revenue ${tag} CY${year}: ${(err as Error).message}`);
      }
    }
  }
  console.log(`SEC revenue: ${revenue.size} companies`);

  const { rows, unmatched } = buildUniverse(holdings, secTickers, revenue);
  const withRevenue = rows.filter((r) => r.revenueUsd).length;
  console.log(`Matched ${rows.length} companies (${withRevenue} with revenue)`);
  for (const source of INDEX_SOURCES) console.log(`  ${source.index}: ${rows.filter((r) => r.index === source.index).length}`);
  if (unmatched.length) console.log(`No SEC match for ${unmatched.length}: ${unmatched.map((u) => u.ticker).join(", ")}`);
  for (const ticker of ["CL", "AAPL", "BRK-B"]) {
    const r = rows.find((row) => row.ticker === ticker);
    if (r) console.log(`  e.g. ${JSON.stringify(r)}`);
  }
  if (rows.length < MIN_COMPANIES) throw new Error(`Only ${rows.length} companies matched, far fewer than 1,500. Nothing was saved.`);

  if (DRY_RUN) {
    // The full list, so a dry run can be checked against (e.g. for matching LinkedIn company names).
    for (const r of rows) console.log(`UNIVERSE\t${r.cik}\t${r.ticker}\t${r.name}\t${r.legalName}`);
    console.log("Dry run: nothing saved.");
    return;
  }
  const db = createClient(SUPABASE_URL!, SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  for (let i = 0; i < rows.length; i += SAVE_BATCH) {
    const batch = rows.slice(i, i + SAVE_BATCH).map((r) => companyRecord(r, importedAt));
    const { error } = await db.from("companies").upsert(batch, { onConflict: "cik" });
    if (error) throw new Error(`Supabase: ${error.message}`);
  }
  console.log(`Saved ${rows.length} companies`);

  // Companies an earlier import saw but this one didn't have left the indexes.
  const { count, error } = await db
    .from("companies")
    .update({ in_index: false }, { count: "exact" })
    .eq("in_index", true)
    .lt("indexed_at", importedAt);
  if (error) throw new Error(`Supabase: ${error.message}`);
  console.log(`${count ?? 0} companies left the indexes since the last import`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
