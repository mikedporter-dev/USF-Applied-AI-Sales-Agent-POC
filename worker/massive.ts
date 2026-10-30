import type { Env } from "./env";

// Massive (massive.com) REST API: company reference data and parsed SEC filing text.

const TIMEOUT_MS = 30_000;

export function isConfigured(env: Env): boolean {
  return Boolean(env.MASSIVE_API_KEY);
}

async function get<T>(env: Env, path: string, params: Record<string, string | number> = {}): Promise<T> {
  if (!env.MASSIVE_API_KEY) throw new Error("MASSIVE_API_KEY is not configured");
  const url = new URL(path, env.MASSIVE_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MASSIVE_API_KEY}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Massive API ${res.status} for ${path}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export interface CompanyProfile {
  ticker: string;
  name: string;
  cik: string;
  sicCode?: string;
  sicDescription?: string;
  employees?: number;
  homepageUrl?: string;
}

export async function companyProfile(env: Env, ticker: string): Promise<CompanyProfile> {
  const { results: r } = await get<{
    results: {
      ticker: string;
      name: string;
      cik?: string;
      sic_code?: string;
      sic_description?: string;
      total_employees?: number;
      homepage_url?: string;
    };
  }>(env, `/v3/reference/tickers/${encodeURIComponent(ticker)}`);
  if (!r?.cik) throw new Error(`No SEC CIK found for ticker ${ticker}. Is it a US-listed company?`);
  return {
    ticker: r.ticker,
    name: r.name,
    cik: r.cik,
    sicCode: r.sic_code,
    sicDescription: r.sic_description,
    employees: r.total_employees,
    homepageUrl: r.homepage_url,
  };
}

export interface TenKSection {
  section: string;
  filingDate: string;
  text: string;
  url: string;
}

/** Business, Risk Factors and MD&A from 10-Ks filed on or after `since`. */
export async function tenKSections(env: Env, ticker: string, since: string): Promise<TenKSection[]> {
  const { results } = await get<{
    results?: { section: string; filing_date: string; text: string; filing_url: string }[];
  }>(env, "/stocks/filings/10-K/vX/sections", { ticker, "filing_date.gte": since, limit: 10 });
  return (results ?? []).map((r) => ({ section: r.section, filingDate: r.filing_date, text: r.text, url: r.filing_url }));
}

export interface EightK {
  accession: string;
  formType: string;
  filingDate: string;
  text: string;
  url: string;
}

export async function eightKs(env: Env, ticker: string, since: string): Promise<EightK[]> {
  const { results } = await get<{
    results?: { accession_number: string; form_type: string; filing_date: string; items_text: string; filing_url: string }[];
  }>(env, "/stocks/filings/8-K/vX/text", { ticker, "filing_date.gte": since, limit: 100 });
  return (results ?? []).map((r) => ({
    accession: r.accession_number,
    formType: r.form_type,
    filingDate: r.filing_date,
    text: r.items_text,
    url: r.filing_url,
  }));
}

export interface Form3 {
  filingDate: string;
  ownerName: string;
  officerTitle?: string;
  isOfficer: boolean;
  url: string;
}

/** Initial-ownership filings by new insiders. Massive returns one row per holding, so dedupe by filing. */
export async function form3s(env: Env, cik: string, since: string): Promise<Form3[]> {
  const { results } = await get<{
    results?: {
      accession_number: string;
      filing_date: string;
      owner_name: string;
      officer_title?: string;
      is_officer?: boolean;
      filing_url: string;
    }[];
  }>(env, "/stocks/filings/vX/form-3", { issuer_cik: cik, "filing_date.gte": since, limit: 100 });
  const byFiling = new Map<string, Form3>();
  for (const r of results ?? []) {
    if (!byFiling.has(r.accession_number)) {
      byFiling.set(r.accession_number, {
        filingDate: r.filing_date,
        ownerName: r.owner_name,
        officerTitle: r.officer_title || undefined,
        isOfficer: Boolean(r.is_officer),
        url: r.filing_url,
      });
    }
  }
  return [...byFiling.values()];
}
