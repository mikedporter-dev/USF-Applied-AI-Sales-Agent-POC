import { htmlToText } from "../src/shared/research";
import type { Env } from "./env";

// SEC EDGAR: free, but SEC requires every request to identify the sender with a
// name and contact email in the User-Agent header. That lives in the
// SEC_USER_AGENT secret, so the contact never appears in the code.

const TIMEOUT_MS = 30_000;

/** Largest document we convert to text. Bigger 10-Qs are cut here to bound CPU time. */
const MAX_DOCUMENT_CHARS = 2_500_000;

export function isConfigured(env: Env): boolean {
  return Boolean(env.SEC_USER_AGENT);
}

async function get(env: Env, url: string): Promise<Response> {
  if (!env.SEC_USER_AGENT) throw new Error("SEC_USER_AGENT is not configured");
  const res = await fetch(url, {
    headers: { "User-Agent": env.SEC_USER_AGENT, Accept: "application/json, text/html;q=0.9, */*;q=0.8" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`SEC EDGAR ${res.status} for ${url}`);
  return res;
}

export interface EdgarFiling {
  form: string;
  filingDate: string;
  accession: string;
  primaryDocument: string;
  /** Filing folder on sec.gov. */
  folderUrl: string;
}

const folder = (cik: string, accession: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;

/** Recent filings of the given forms filed on or after `since`, newest first. */
export async function recentFilings(env: Env, cik: string, forms: string[], since: string): Promise<EdgarFiling[]> {
  const res = await get(env, `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
  const { filings } = (await res.json()) as {
    filings: {
      recent: { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] };
    };
  };
  const r = filings.recent;
  const out: EdgarFiling[] = [];
  for (let i = 0; i < r.form.length; i++) {
    if (r.filingDate[i] < since) break; // newest first
    if (!forms.includes(r.form[i])) continue;
    out.push({
      form: r.form[i],
      filingDate: r.filingDate[i],
      accession: r.accessionNumber[i],
      primaryDocument: r.primaryDocument[i],
      folderUrl: folder(cik, r.accessionNumber[i]),
    });
  }
  return out;
}

export interface EdgarDocument {
  /** File name; exhibits are usually recognizable by name, e.g. ex991.htm for an earnings release. */
  name: string;
  /** Size in bytes, when SEC reports it. */
  size?: number;
  url: string;
}

/** The documents inside one filing, such as the main report and its exhibits. */
export async function filingDocuments(env: Env, cik: string, accession: string): Promise<EdgarDocument[]> {
  const base = folder(cik, accession);
  const res = await get(env, `${base}/index.json`);
  const { directory } = (await res.json()) as { directory: { item: { name: string; size?: string }[] } };
  return directory.item
    // Skip index pages and the XBRL viewer pages (R1.htm, R2.htm, ...), which aren't documents.
    .filter((d) => /\.(htm|html|txt)$/i.test(d.name) && !/index/i.test(d.name) && !/^R\d+\.htm$/i.test(d.name))
    .map((d) => ({ name: d.name, size: d.size ? Number(d.size) || undefined : undefined, url: `${base}/${d.name}` }));
}

/** Fetch one document and return it as plain text. */
export async function documentText(env: Env, url: string): Promise<string> {
  if (!url.startsWith("https://www.sec.gov/Archives/edgar/data/")) {
    throw new Error("Only documents under https://www.sec.gov/Archives/edgar/data/ can be read.");
  }
  const raw = (await (await get(env, url)).text()).slice(0, MAX_DOCUMENT_CHARS);
  return /\.txt$/i.test(url) ? raw : htmlToText(raw);
}

/** XBRL tags companies use for total revenue, most common first. */
const REVENUE_TAGS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "SalesRevenueNet",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
];

export interface AnnualRevenue {
  usd: number;
  /** Last day of the fiscal year, YYYY-MM-DD. */
  fiscalYearEnd: string;
  tag: string;
  form: string;
  filed: string;
}

interface ConceptFact {
  start?: string;
  end: string;
  val: number;
  form: string;
  filed: string;
}

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/**
 * Latest full-year revenue the company reported in a 10-K, from SEC's XBRL data.
 * Companies switch revenue tags over time, so every common tag is checked and
 * the most recent fiscal year wins.
 */
export async function annualRevenue(env: Env, cik: string): Promise<AnnualRevenue | undefined> {
  const padded = cik.padStart(10, "0");
  const results = await Promise.allSettled(
    REVENUE_TAGS.map(async (tag) => {
      const res = await get(env, `https://data.sec.gov/api/xbrl/companyconcept/CIK${padded}/us-gaap/${tag}.json`);
      const { units } = (await res.json()) as { units?: { USD?: ConceptFact[] } };
      return (units?.USD ?? [])
        .filter((f) => f.form.startsWith("10-K") && f.start && days(f.start, f.end) > 330 && days(f.start, f.end) < 400)
        .map((f) => ({ usd: f.val, fiscalYearEnd: f.end, tag, form: f.form, filed: f.filed }));
    }),
  );
  const annual = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // Latest fiscal year; for the same year, the latest filing (restatements win).
  annual.sort((a, b) => b.fiscalYearEnd.localeCompare(a.fiscalYearEnd) || b.filed.localeCompare(a.filed));
  return annual[0];
}
