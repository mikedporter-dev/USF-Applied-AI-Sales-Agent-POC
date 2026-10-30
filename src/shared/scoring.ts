import type { AccountInput, Connection, ScoredAccount, Seniority, Signal, SignalKind, Tier } from "./types";

// All weights live here so they can be tuned in one place.

export const WINDOW_MONTHS = 12;

export const COMPOSITE_WEIGHTS = { fit: 0.3, intent: 0.4, gap: 0.3 } as const;

/** Composite multiplier for companies already publishing large-scale AI results. */
export const DEMOTION_FACTOR = 0.6;

export const TIER_THRESHOLDS = { tier1: 65, tier2: 45 } as const;

export const OUTREACH_LIST = { min: 50, max: 100 } as const;

/** Apollo search order: the first role found at an account becomes its target. */
export const CONTACT_ROLE_LADDER = [
  ["Chief AI Officer", "Head of AI"],
  ["Chief Data Officer", "Chief Data & Analytics Officer"],
  ["Chief Information Officer", "Chief Technology Officer"],
  ["Chief Digital Officer", "Chief Transformation Officer"],
] as const;

/** How well each GICS sector fits an AI transformation services offer (0–1). */
export const INDUSTRY_FIT: Record<string, number> = {
  Financials: 1,
  "Health Care": 1,
  Industrials: 0.9,
  "Consumer Staples": 0.85,
  "Consumer Discretionary": 0.85,
  Energy: 0.8,
  Utilities: 0.8,
  Materials: 0.75,
  "Communication Services": 0.7,
  "Real Estate": 0.6,
  "Information Technology": 0.5,
};
const DEFAULT_INDUSTRY_FIT = 0.6;

const INTENT_POINTS: Partial<Record<SignalKind, { points: number; max: number }>> = {
  ai_commitment: { points: 25, max: 50 },
  // Generic AI language: a weak signal, capped so it can never rival one concrete commitment.
  ai_mention: { points: 5, max: 10 },
  ai_reorg: { points: 25, max: 25 },
  leadership_change: { points: 20, max: 20 },
  acquisition: { points: 15, max: 15 },
  restructuring: { points: 10, max: 10 },
};

const TRIGGER_KINDS: SignalKind[] = ["leadership_change", "acquisition", "restructuring", "ai_reorg"];

const SENIORITY_ORDER: Seniority[] = ["Manager", "Director", "VP", "C-Suite", "Owner/Partner"];

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  ai_commitment: "AI commitment",
  ai_mention: "AI mention",
  leadership_change: "Leadership change",
  acquisition: "Acquisition",
  restructuring: "Restructuring",
  ai_reorg: "AI-driven reorg",
  ai_pilot_no_results: "Pilot, no results",
  ai_scaled_results: "Scaled AI results",
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function sizeFactor(revenueUsd: number): number {
  if (revenueUsd >= 10e9) return 1;
  if (revenueUsd >= 2e9) return 0.8;
  if (revenueUsd >= 500e6) return 0.55;
  return 0.3;
}

export function inWindow(signal: Signal, asOf: Date): boolean {
  const start = new Date(asOf);
  start.setUTCMonth(start.getUTCMonth() - WINDOW_MONTHS);
  const filed = new Date(signal.filedAt);
  return filed >= start && filed <= asOf;
}

const count = (signals: Signal[], kind: SignalKind) => signals.filter((s) => s.kind === kind).length;

export function fitScore(input: AccountInput): number {
  const industry = INDUSTRY_FIT[input.company.industry] ?? DEFAULT_INDUSTRY_FIT;
  return clamp(100 * (0.6 * sizeFactor(input.company.revenueUsd) + 0.4 * industry));
}

export function intentScore(signals: Signal[]): number {
  let total = 0;
  for (const [kind, rule] of Object.entries(INTENT_POINTS)) {
    total += Math.min(count(signals, kind as SignalKind) * rule.points, rule.max);
  }
  return clamp(total);
}

/** Gap = stated ambition without reported results. */
export function gapScore(signals: Signal[]): number {
  const pilots = Math.min(count(signals, "ai_pilot_no_results") * 40, 80);
  const ambitionWithoutResults =
    count(signals, "ai_commitment") > 0 && count(signals, "ai_scaled_results") === 0 ? 20 : 0;
  return clamp(pilots + ambitionWithoutResults);
}

export function tierFor(total: number): Tier {
  if (total >= TIER_THRESHOLDS.tier1) return 1;
  if (total >= TIER_THRESHOLDS.tier2) return 2;
  return 3;
}

export function bestConnection(connections: Connection[]): Connection | undefined {
  return [...connections].sort(
    (a, b) => SENIORITY_ORDER.indexOf(b.seniority) - SENIORITY_ORDER.indexOf(a.seniority),
  )[0];
}

function latestTrigger(signals: Signal[]): Signal | undefined {
  return signals
    .filter((s) => TRIGGER_KINDS.includes(s.kind))
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt))[0];
}

function reasons(signals: Signal[], fit: number, demoted: boolean): string[] {
  const out: string[] = [];
  if (fit >= 80) out.push("Strong size and industry fit");
  const commitments = count(signals, "ai_commitment");
  if (commitments) out.push(`${commitments} concrete AI commitment${commitments > 1 ? "s" : ""} in filings`);
  if (count(signals, "ai_reorg")) out.push("Reorganizing around AI");
  const pilots = count(signals, "ai_pilot_no_results");
  if (pilots) out.push(`${pilots} AI pilot${pilots > 1 ? "s" : ""} with no reported results`);
  if (demoted) out.push("Demoted: already reports large-scale AI results");
  return out;
}

/**
 * Score one account on Fit, Intent, and Gap using only signals from the trailing
 * window, demoting it if it already publishes scaled AI results. Its rank is 0
 * until it is ranked against others by scoreAccounts.
 */
export function scoreAccount(input: AccountInput, asOf = new Date()): ScoredAccount {
  const signals = input.signals.filter((s) => inWindow(s, asOf));
  const fit = fitScore(input);
  const intent = intentScore(signals);
  const gap = gapScore(signals);
  const demoted = count(signals, "ai_scaled_results") > 0;
  const weighted = COMPOSITE_WEIGHTS.fit * fit + COMPOSITE_WEIGHTS.intent * intent + COMPOSITE_WEIGHTS.gap * gap;
  const total = clamp(demoted ? weighted * DEMOTION_FACTOR : weighted);
  return {
    ...input,
    signals,
    rank: 0,
    tier: tierFor(total),
    scores: { fit, intent, gap, total },
    demoted,
    whyRanks: reasons(signals, fit, demoted),
    whyNow: latestTrigger(signals),
    warmPath: bestConnection(input.connections),
  };
}

/**
 * Score and rank accounts. Accounts with no Manager+ connection are excluded:
 * the agent starts from the network.
 */
export function scoreAccounts(inputs: AccountInput[], asOf = new Date()): ScoredAccount[] {
  return inputs
    .filter((input) => input.connections.length > 0)
    .map((input) => scoreAccount(input, asOf))
    .sort((a, b) => b.scores.total - a.scores.total || a.company.name.localeCompare(b.company.name))
    .map((account, i) => ({ ...account, rank: i + 1 }));
}

/** Tier 1 first, then Tier 2 to fill, capped at OUTREACH_LIST.max. Tier 3 is never included. */
export function selectOutreachList(ranked: ScoredAccount[], max: number = OUTREACH_LIST.max): ScoredAccount[] {
  const tier1 = ranked.filter((a) => a.tier === 1);
  const tier2 = ranked.filter((a) => a.tier === 2);
  return [...tier1, ...tier2].slice(0, max);
}
