import type { Seniority } from "./types";

// LinkedIn import: read the seller's Connections.csv export, keep Manager+
// connections, and match their companies to the S&P 1500. Runs in the browser,
// so the export (with emails and profile links) never leaves it; only matched
// connections are sent to be saved.

export interface LinkedInConnection {
  name: string;
  company: string;
  position: string;
  /** YYYY-MM-DD */
  connectedOn?: string;
}

/** Parse CSV text into rows, honoring quotes (a quoted field can hold commas, quotes and line breaks). */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "07 Oct 2026" → "2026-10-07". */
function isoDate(text: string): string | undefined {
  const m = text.trim().match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/);
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  return m && month >= 0 ? `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}` : undefined;
}

/**
 * Parse LinkedIn's Connections.csv: a few "Notes" lines, then a header row
 * (First Name, Last Name, URL, Email Address, Company, Position, Connected On).
 * Emails and profile links are not kept.
 */
export function parseConnectionsCsv(text: string): LinkedInConnection[] {
  const rows = csvRows(text.replace(/^﻿/, ""));
  const headerAt = rows.findIndex((r) => r[0]?.trim() === "First Name");
  if (headerAt === -1) throw new Error("This doesn't look like LinkedIn's Connections.csv: no First Name header row.");
  const header = rows[headerAt].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [first, last, company, position, connected] = ["first name", "last name", "company", "position", "connected on"].map(col);
  if (company < 0 || position < 0) throw new Error("The file is missing the Company or Position column.");
  return rows
    .slice(headerAt + 1)
    .map((r) => ({
      name: `${r[first] ?? ""} ${r[last] ?? ""}`.trim(),
      company: (r[company] ?? "").trim(),
      position: (r[position] ?? "").trim(),
      connectedOn: connected >= 0 ? isoDate(r[connected] ?? "") : undefined,
    }))
    .filter((c) => c.name);
}

/**
 * Seniority from a job title, or undefined below Manager. Checked from the top
 * down, so "President & CEO" is C-Suite and "Senior Partner Manager" is Manager.
 */
export function seniorityFor(title: string): Seniority | undefined {
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9&+]+/g, " ")} `;
  if (/ (intern|internship|student) /.test(t)) return undefined;
  // "Vice President" says nothing about being president.
  const v = t.replace(/ (senior |executive |assistant |associate |group )?vice president /g, " vp ");
  if (
    / (co ?founder|founder|owner|managing director) /.test(v) ||
    /^ (senior |managing |general |founding |equity )?partner (?!(manager|marketing|success|development|relations|solutions|engineer|account|sales|program|operations|lead|enablement))/.test(v)
  ) {
    return "Owner/Partner";
  }
  if (/ chief [a-z& ]*officer | (ceo|cfo|cto|cio|coo|cmo|cdo|cro|cpo|caio|chro|cdao|cxo) | president /.test(v)) return "C-Suite";
  if (/ (vp|svp|evp|avp|head of|general manager|gm) /.test(v)) return "VP";
  if (/ (director|associate partner|editor in chief) /.test(v)) return "Director";
  if (/ (manager|mgr) /.test(v)) return "Manager";
  return undefined;
}

const SUFFIXES = new Set([
  "the", "inc", "incorporated", "corp", "corporation", "co", "company", "companies", "ltd", "limited",
  "plc", "llc", "lp", "llp", "holdings", "holding", "group", "sa", "nv", "ag", "se",
]);

/** Compare company names the way people write them: "The Walt Disney Company" and "WALT DISNEY CO" are the same. */
export function companyKey(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // Mondelēz → Mondelez
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ") // "Amazon Web Services (AWS)"
    .replace(/[.'’]/g, "") // J.P. → jp, McDonald's → mcdonalds
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !SUFFIXES.has(w));
  while (words.at(-1) === "and") words.pop(); // "JPMorgan Chase & Co."
  return words.join(" ");
}

/**
 * Brands and subsidiaries people list on LinkedIn, by the ticker of the listed
 * parent. Aliases whose parent isn't in the S&P 1500 are ignored.
 */
const ALIASES: Record<string, string[]> = {
  "GOOGL GOOG": ["google", "youtube", "google cloud", "google deepmind", "deepmind", "waymo", "fitbit"],
  AMZN: [
    "aws", "amazon web services", "prime video", "amazon mgm studios", "prime video and amazon mgm studios",
    "amazon studios", "amazon ads", "amazon advertising", "twitch", "audible", "whole foods market", "zappos", "ring", "imdb",
  ],
  CMCSA: [
    "nbcuniversal", "nbc universal", "nbcuniversal media", "nbcuniversal telemundo enterprises", "telemundo",
    "nbc sports", "nbc news", "universal pictures", "universal studios", "universal filmed entertainment",
    "universal parks and resorts", "dreamworks animation", "peacock", "xfinity", "comcast business", "comcast cable",
  ],
  DIS: [
    "disney", "espn", "disney entertainment", "walt disney studios", "walt disney imagineering", "walt disney television",
    "disney parks experiences and products", "disney streaming", "disney advertising", "abc", "abc news", "hulu",
    "marvel studios", "marvel entertainment", "pixar", "pixar animation studios", "lucasfilm", "20th century studios",
    "searchlight pictures", "fx networks",
  ],
  META: ["meta", "facebook", "instagram", "whatsapp", "oculus", "reality labs", "meta reality labs"],
  MSFT: ["linkedin", "github", "xbox", "microsoft gaming", "activision blizzard", "activision", "blizzard entertainment", "bethesda softworks"],
  "FOXA FOX": ["fox sports", "fox news", "fox news media", "fox entertainment", "fox television stations", "tubi"],
  "PSKY PARA": [
    "paramount", "paramount global", "paramount pictures", "paramount streaming", "cbs", "cbs news", "cbs sports",
    "cbs interactive", "nickelodeon", "showtime", "mtv", "pluto tv", "skydance", "skydance media", "skydance animation",
  ],
  WBD: ["warner bros", "warnermedia", "hbo", "hbo max", "max", "cnn", "discovery", "warner bros games", "tnt sports", "turner sports", "dc studios"],
  CHTR: ["spectrum", "spectrum networks", "spectrum reach"],
  TMUS: ["t mobile"],
  "NWSA NWS": ["dow jones", "wall street journal"],
  JPM: ["jpmorgan", "jp morgan", "jpmorgan chase", "jp morgan chase", "chase", "jp morgan asset management"],
  BAC: ["merrill", "merrill lynch", "bofa securities"],
  C: ["citi", "citibank"],
  PG: ["p and g"],
  PEP: ["frito lay", "gatorade"],
  CRM: ["slack", "tableau", "mulesoft"],
  UNH: ["optum"],
  CVS: ["aetna"],
  LYV: ["ticketmaster"],
  SIRI: ["pandora", "siriusxm"],
  WMT: ["walmart connect", "sams club"],
  SBGI: ["sinclair broadcast"],
  BALY: ["ballys interactive"],
  F: ["ford"],
};

export interface UniverseCompany {
  cik: string;
  ticker: string;
  name: string;
  legalName?: string;
}

/**
 * Words that name a unit or region of a company rather than a different
 * company: "Verizon Business" is Verizon, but "Universal Music" isn't Universal
 * Corp and "Universal Health" isn't either.
 */
const UNIT_WORDS = new Set([
  "business", "businesses", "cloud", "digital", "studio", "studios", "labs", "ventures", "advertising", "ads",
  "enterprise", "enterprises", "commercial", "international", "global", "worldwide", "usa", "us", "america",
  "americas", "north", "latin", "europe", "emea", "apac", "asia", "japan", "uk", "canada", "india", "mexico",
]);

export interface CompanyMatcher {
  match(company: string): UniverseCompany | undefined;
}

/**
 * Index the S&P 1500 by name, SEC name and the aliases above. Aliases match
 * exactly; official names also match when followed by unit or region words
 * ("Verizon Business"), which isn't safe for brands ("Spectrum Health").
 */
export function companyMatcher(companies: UniverseCompany[]): CompanyMatcher {
  const byName = new Map<string, UniverseCompany>();
  const byAlias = new Map<string, UniverseCompany>();
  const add = (map: Map<string, UniverseCompany>, key: string, c: UniverseCompany) => key && !map.has(key) && map.set(key, c);
  for (const c of companies) {
    add(byName, companyKey(c.name), c);
    if (c.legalName) add(byName, companyKey(c.legalName), c);
  }
  const byTicker = new Map(companies.map((c) => [c.ticker, c]));
  for (const [tickers, names] of Object.entries(ALIASES)) {
    const parent = tickers.split(" ").map((t) => byTicker.get(t)).find(Boolean);
    if (parent) for (const n of names) add(byAlias, companyKey(n), parent);
  }
  return {
    match(company) {
      const key = companyKey(company);
      if (!key) return undefined;
      const exact = byName.get(key) ?? byAlias.get(key);
      if (exact) return exact;
      // "Verizon Business": a listed name followed only by unit or region words.
      const words = key.split(" ");
      for (let n = words.length - 1; n >= 1 && UNIT_WORDS.has(words[n]); n--) {
        const hit = byName.get(words.slice(0, n).join(" "));
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

export interface MatchedConnection {
  cik: string;
  name: string;
  title: string;
  seniority: Seniority;
  connectedOn?: string;
  /** The company as the person listed it, e.g. "NBCUniversal" for Comcast. */
  companyAsListed: string;
}

export interface ConnectionMatch {
  total: number;
  managerPlus: number;
  matched: MatchedConnection[];
  /** Manager+ connections' companies that aren't in the S&P 1500, most common first. */
  unmatchedCompanies: { company: string; count: number }[];
}

export function matchConnections(connections: LinkedInConnection[], matcher: CompanyMatcher): ConnectionMatch {
  const matched: MatchedConnection[] = [];
  const unmatched = new Map<string, number>();
  let managerPlus = 0;
  for (const c of connections) {
    const seniority = seniorityFor(c.position);
    if (!seniority || !c.company) continue;
    managerPlus++;
    const company = matcher.match(c.company);
    if (company) {
      matched.push({ cik: company.cik, name: c.name, title: c.position, seniority, connectedOn: c.connectedOn, companyAsListed: c.company });
    } else {
      unmatched.set(c.company, (unmatched.get(c.company) ?? 0) + 1);
    }
  }
  return {
    total: connections.length,
    managerPlus,
    matched,
    unmatchedCompanies: [...unmatched].map(([company, count]) => ({ company, count })).sort((a, b) => b.count - a.count),
  };
}

/** Connections per save request. */
export const CONNECTION_BATCH = 500;

const SENIORITIES: Seniority[] = ["Manager", "Director", "VP", "C-Suite", "Owner/Partner"];
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Validate a batch sent to POST /api/connections. Returns the batch, or an error. */
export function parseConnectionBatch(body: unknown): { importedAt: string; connections: MatchedConnection[] } | string {
  const b = body as { importedAt?: unknown; connections?: unknown } | null;
  if (!b || typeof b.importedAt !== "string" || Number.isNaN(Date.parse(b.importedAt))) return "importedAt must be a timestamp";
  if (!Array.isArray(b.connections) || b.connections.length === 0 || b.connections.length > CONNECTION_BATCH) {
    return `connections must be 1 to ${CONNECTION_BATCH} people`;
  }
  for (const c of b.connections as MatchedConnection[]) {
    if (!/^\d{10}$/.test(c?.cik)) return `bad cik: ${JSON.stringify(c?.cik)}`;
    if (!text(c.name, 200) || !text(c.title, 300) || !text(c.companyAsListed, 200)) return `missing name, title or company for ${c.cik}`;
    if (!SENIORITIES.includes(c.seniority)) return `bad seniority for ${c.name}`;
    if (c.connectedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(c.connectedOn)) return `bad date for ${c.name}`;
  }
  return { importedAt: b.importedAt, connections: b.connections as MatchedConnection[] };
}
