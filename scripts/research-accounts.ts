// Saved research, run by .github/workflows/research-accounts.yml.
//
// Runs the research agent (worker/research.ts, the same one behind /research/)
// on the next companies in the queue: those where the seller has a Manager+
// connection, never-researched first. Each run's signals and quotes are saved to
// Supabase, where the ranked accounts read them.
//
// Env: NVIDIA_API_KEY, MASSIVE_API_KEY, SEC_USER_AGENT, and SUPABASE_URL plus
// SUPABASE_SECRET_KEY to save. RESEARCH_LIMIT sets companies per run (default 10).
// With DRY_RUN=true, or without Supabase, it researches TICKERS (default CL),
// prints what it found, and saves nothing.

import { readFileSync } from "node:fs";
import type { ResearchEvent, ResearchResult } from "../src/shared/research";
import type { Env } from "../worker/env";
import { runResearch } from "../worker/research";
import * as supabase from "../worker/supabase";

const LIMIT = Math.max(1, Math.min(25, Number(process.env.RESEARCH_LIMIT) || 10));
/** Pause between companies, so Massive's per-minute limit has room. */
const PAUSE_MS = 20_000;

/** Non-secret settings (model, API base URLs) from wrangler.jsonc, so the Worker and this script agree. */
function wranglerVars(): Record<string, string> {
  const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const json = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return (JSON.parse(json) as { vars: Record<string, string> }).vars;
}

const vars = wranglerVars();
const env = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  NVIDIA_BASE_URL: vars.NVIDIA_BASE_URL,
  NVIDIA_MODEL: vars.NVIDIA_MODEL,
  MASSIVE_BASE_URL: vars.MASSIVE_BASE_URL,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
  MASSIVE_API_KEY: process.env.MASSIVE_API_KEY,
  SEC_USER_AGENT: process.env.SEC_USER_AGENT,
  SUPABASE_URL: process.env.SUPABASE_URL || undefined,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || undefined,
} satisfies Env;
const DRY_RUN = process.env.DRY_RUN === "true" || !supabase.isConfigured(env);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The agent's progress, one line per step. Everything here is public filing data. */
async function log(event: ResearchEvent): Promise<void> {
  if (event.type === "status") console.log(`  ${event.message}`);
  else if (event.type === "tool") console.log(`  ${event.name}: ${event.detail}`);
  else if (event.type === "rejected") console.log(`  rejected ${event.tool}: ${event.reason.slice(0, 200)}`);
  else if (event.type === "signal") console.log(`  + ${event.signal.kind}: ${event.signal.summary} (${event.signal.form}, ${event.signal.filedAt})`);
}

function report(result: ResearchResult): string {
  return `${result.stopReason}; ${result.signals.length} signals; score ${result.scores.total} (fit ${result.scores.fit}, intent ${result.scores.intent}, gap ${result.scores.gap}), tier ${result.tier}`;
}

/** Massive writes share classes with a dot (BRK.B); SEC with a dash (BRK-B). */
const massiveTicker = (ticker: string) => ticker.replace("-", ".");

async function main() {
  for (const key of ["NVIDIA_API_KEY", "MASSIVE_API_KEY", "SEC_USER_AGENT"] as const) {
    if (!env[key]) throw new Error(`${key} is required.`);
  }

  if (DRY_RUN) {
    const tickers = (process.env.TICKERS || "CL").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    console.log(`Saved research, dry run (nothing will be saved): ${tickers.join(", ")}`);
    for (const [i, ticker] of tickers.entries()) {
      if (i > 0) await sleep(PAUSE_MS);
      console.log(`\n${ticker}`);
      const result = await runResearch(env, massiveTicker(ticker), log);
      console.log(`  => ${report(result)}`);
    }
    return;
  }

  const queue = await supabase.researchQueue(env, LIMIT);
  console.log(`Saved research: ${queue.length} companies this run (up to ${LIMIT})`);
  let failed = 0;
  for (const [i, company] of queue.entries()) {
    if (i > 0) await sleep(PAUSE_MS);
    console.log(`\n${company.ticker} · ${company.name} · ${company.connections} connections`);
    const startedAt = new Date().toISOString();
    try {
      const result = await runResearch(env, massiveTicker(company.ticker), log);
      const { replacedSignals } = await supabase.saveResearchRun(env, { cik: company.cik, startedAt, model: env.NVIDIA_MODEL, result });
      console.log(`  => ${report(result)}${replacedSignals ? "" : "; earlier signals kept"}`);
    } catch (err) {
      failed++;
      const error = err instanceof Error ? err.message : String(err);
      console.log(`  => error: ${error}`);
      await supabase.saveResearchRun(env, { cik: company.cik, startedAt, model: env.NVIDIA_MODEL, error }).catch(() => {});
    }
  }
  console.log(`\nDone: ${queue.length - failed} researched, ${failed} failed`);
  // One failure isn't a failed run; most failing points at a service or key problem.
  if (queue.length && failed > queue.length / 2) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
