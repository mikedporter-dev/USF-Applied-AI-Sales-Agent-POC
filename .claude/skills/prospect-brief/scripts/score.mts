// Score one account with the app's own rules (src/shared/scoring.ts), so a brief
// from this skill ranks exactly the way the app would rank it.
//
// Usage:
//   node --experimental-strip-types --no-warnings \
//     .claude/skills/prospect-brief/scripts/score.mts <account.json> [as-of YYYY-MM-DD]
//
// <account.json> is an AccountInput (see src/shared/types.ts): { company, signals, connections }.
// Prints the scores, tier, reasons, why-now signal, and which signals fell outside the window.
import { readFileSync } from "node:fs";
import { inWindow, scoreAccounts, TIER_THRESHOLDS } from "../../../../src/shared/scoring.ts";
import type { AccountInput } from "../../../../src/shared/types.ts";

const [file, asOfArg] = process.argv.slice(2);
if (!file) {
  console.error("usage: score.mts <account.json> [as-of YYYY-MM-DD]");
  process.exit(1);
}

const input = JSON.parse(readFileSync(file, "utf8")) as AccountInput;
const asOf = asOfArg ? new Date(`${asOfArg}T00:00:00Z`) : new Date();

// The app only scores companies where the seller has a Manager+ connection. Score
// the account anyway so the brief can say how it would rank, and flag it.
const notInNetwork = input.connections.length === 0;
const scored = scoreAccounts(
  [notInNetwork ? { ...input, connections: [{ name: "(none)", title: "", seniority: "Manager" }] } : input],
  asOf,
)[0];

console.log(
  JSON.stringify(
    {
      asOf: asOf.toISOString().slice(0, 10),
      tier: scored.tier,
      tierThresholds: TIER_THRESHOLDS,
      scores: scored.scores,
      demoted: scored.demoted,
      whyRanks: scored.whyRanks,
      whyNow: scored.whyNow ?? null,
      warmPath: notInNetwork ? null : scored.warmPath,
      notInNetwork,
      signalsCounted: scored.signals.length,
      signalsOutsideWindow: input.signals.filter((s) => !inWindow(s, asOf)),
    },
    null,
    2,
  ),
);
