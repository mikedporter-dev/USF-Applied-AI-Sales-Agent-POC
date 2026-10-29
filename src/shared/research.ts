import { INDUSTRY_FIT, inWindow, WINDOW_MONTHS } from "./scoring";
import type { FilingForm, Scores, Signal, SignalKind, SignalSource, Tier } from "./types";

// The account research agent: shared types and the checks every finding must
// pass before it counts. Kept free of Worker APIs so it can be unit-tested.

export const SIGNAL_KINDS: readonly SignalKind[] = [
  "ai_commitment",
  "leadership_change",
  "acquisition",
  "restructuring",
  "ai_reorg",
  "ai_pilot_no_results",
  "ai_scaled_results",
];

export const FILING_FORMS: readonly FilingForm[] = ["10-K", "10-Q", "8-K", "8-K EX-99", "Form 3"];

export const GICS_SECTORS = Object.keys(INDUSTRY_FIT);

/** Quotes must be long enough to be checkable and short enough to be a quote. */
export const QUOTE_LENGTH = { min: 20, max: 600 } as const;

/** What the agent has read this run, by document URL. Quotes are checked against it. */
export type Corpus = Map<string, { text: string; source: SignalSource; filedAt?: string }>;

export function addToCorpus(corpus: Corpus, url: string, text: string, source: SignalSource, filedAt?: string): void {
  const prev = corpus.get(url);
  corpus.set(url, { text: `${prev?.text ?? ""}\n${text}`, source, filedAt: filedAt ?? prev?.filedAt });
}

/** Compare text the way a reader would: case, whitespace and curly quotes don't matter. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Most text an ellipsis may stand for, so a shortened quote can't stitch distant passages together. */
const MAX_ELLIPSIS_GAP = 1000;

/** A shortened quote ("A ... B") is checked piece by piece: each piece must appear, in order, close together. */
function quoteInText(text: string, quote: string): boolean {
  const pieces = quote
    .split(/\[\.\.\.\]|\.\.\.|\u2026/)
    .map((p) => normalizeText(p).replace(/^["']+|["']+$/g, "").trim())
    .filter((p) => p.length >= 12);
  if (pieces.length === 0) return false;
  const haystack = normalizeText(text);
  // Try each place the first piece occurs, so a later, closer match isn't missed.
  for (let start = haystack.indexOf(pieces[0]); start !== -1; start = haystack.indexOf(pieces[0], start + 1)) {
    let end = start + pieces[0].length;
    let ok = true;
    for (const piece of pieces.slice(1)) {
      const at = haystack.indexOf(piece, end);
      if (at === -1 || at - end > MAX_ELLIPSIS_GAP) {
        ok = false;
        break;
      }
      end = at + piece.length;
    }
    if (ok) return true;
  }
  return false;
}

/**
 * The document the quote actually comes from: the one the agent named if the
 * quote is there, otherwise any document read this run that contains it.
 */
export function locateQuote(corpus: Corpus, quote: string, url?: unknown): string | undefined {
  if (typeof url === "string" && corpus.has(url) && quoteInText(corpus.get(url)!.text, quote)) return url;
  for (const [candidate, entry] of corpus) if (quoteInText(entry.text, quote)) return candidate;
  return undefined;
}

export interface RecordedSignal extends Signal {
  quote: string;
}

/**
 * Validate a record_signal call from the agent. Returns the signal, or the reason
 * it was rejected so the agent can correct itself. The quote must appear in text
 * the agent actually read this run; the url, source and (when known) filing date
 * are taken from the document it was found in, not from the agent.
 */
export function validateSignal(args: unknown, corpus: Corpus, asOf: Date): RecordedSignal | string {
  if (typeof args !== "object" || args === null) return "Arguments must be an object.";
  const a = args as Record<string, unknown>;

  if (!SIGNAL_KINDS.includes(a.kind as SignalKind)) return `kind must be one of: ${SIGNAL_KINDS.join(", ")}.`;
  if (!FILING_FORMS.includes(a.form as FilingForm)) return `form must be one of: ${FILING_FORMS.join(", ")}.`;
  if (typeof a.summary !== "string" || a.summary.trim().length < 10) return "summary must be a sentence.";
  if (typeof a.filed_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.filed_at)) {
    return "filed_at must be the filing date as YYYY-MM-DD.";
  }
  if (typeof a.quote !== "string" || a.quote.length < QUOTE_LENGTH.min || a.quote.length > QUOTE_LENGTH.max) {
    return `quote must be ${QUOTE_LENGTH.min}-${QUOTE_LENGTH.max} characters copied from the filing.`;
  }
  const url = locateQuote(corpus, a.quote, a.url);
  if (!url) return "quote was not found in any text you read this run. Copy it exactly from a tool result.";
  const doc = corpus.get(url)!;

  const signal: RecordedSignal = {
    kind: a.kind as SignalKind,
    summary: a.summary.trim(),
    form: a.form as FilingForm,
    section: typeof a.section === "string" && a.section.trim() ? a.section.trim() : undefined,
    filedAt: doc.filedAt ?? a.filed_at,
    source: doc.source,
    url,
    quote: a.quote.trim(),
  };
  if (!inWindow(signal, asOf)) return `filed_at is outside the ${WINDOW_MONTHS}-month window.`;
  return signal;
}

export interface CompanyFacts {
  gicsSector: string;
  revenueUsd?: number;
  revenueQuote?: string;
  revenueUrl?: string;
}

/**
 * Validate a set_company_facts call. A valid sector is kept even when the revenue
 * part fails; revenue only counts with a quote found in text read this run.
 */
export function validateFacts(args: unknown, corpus: Corpus): { facts: CompanyFacts; revenueError?: string } | string {
  if (typeof args !== "object" || args === null) return "Arguments must be an object.";
  const a = args as Record<string, unknown>;
  if (typeof a.gics_sector !== "string" || !GICS_SECTORS.includes(a.gics_sector)) {
    return `gics_sector must be one of: ${GICS_SECTORS.join(", ")}.`;
  }
  const sectorOnly = { gicsSector: a.gics_sector };
  if (a.revenue_usd === undefined || a.revenue_usd === null) return { facts: sectorOnly };

  if (typeof a.revenue_usd !== "number" || !Number.isFinite(a.revenue_usd) || a.revenue_usd <= 0) {
    return { facts: sectorOnly, revenueError: "revenue_usd must be a positive number of US dollars (not millions)." };
  }
  const url = typeof a.revenue_quote === "string" ? locateQuote(corpus, a.revenue_quote, a.url) : undefined;
  if (!url) {
    return {
      facts: sectorOnly,
      revenueError: "revenue_quote was not found in any text you read this run. Copy it exactly from a tool result.",
    };
  }
  return {
    facts: { gicsSector: a.gics_sector, revenueUsd: a.revenue_usd, revenueQuote: a.revenue_quote as string, revenueUrl: url },
  };
}

export interface ResearchResult {
  company: {
    cik: string;
    ticker: string;
    name: string;
    /** GICS sector, if the agent set it. */
    industry?: string;
    /** Annual revenue, if the agent found and quoted it. */
    revenueUsd?: number;
    employees?: number;
  };
  tier: Tier;
  scores: Scores;
  demoted: boolean;
  whyRanks: string[];
  whyNow?: Signal;
  signals: RecordedSignal[];
  facts?: CompanyFacts;
  /** The agent's own wrap-up, from its finish call. */
  summary?: string;
  /** Why the run ended. */
  stopReason: "finished" | "step_limit";
  usedEdgar: boolean;
  nextStep: string;
}

/** Events streamed to the browser as newline-delimited JSON while the agent works. */
export type ResearchEvent =
  | { type: "status"; message: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "signal"; signal: RecordedSignal }
  | { type: "rejected"; tool: string; reason: string; attempted?: string }
  | { type: "result"; result: ResearchResult }
  | { type: "error"; message: string };

/**
 * Up to `max` passages of about `radius` characters either side of each match,
 * so the agent can search long filings without reading all of them.
 */
export function findPassages(text: string, terms: string[], radius = 500, max = 6): string[] {
  const lower = text.toLowerCase();
  const hits: number[] = [];
  for (const term of terms.map((t) => t.toLowerCase().trim()).filter(Boolean)) {
    let i = lower.indexOf(term);
    while (i !== -1 && hits.length < 200) {
      hits.push(i);
      i = lower.indexOf(term, i + term.length);
    }
  }
  hits.sort((a, b) => a - b);
  const passages: string[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    const start = Math.max(0, hit - radius);
    if (start <= lastEnd) continue; // overlaps the previous passage
    const end = Math.min(text.length, hit + radius);
    passages.push(text.slice(start, end).trim());
    lastEnd = end;
    if (passages.length >= max) break;
  }
  return passages;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Turn an SEC HTML document into readable plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}
