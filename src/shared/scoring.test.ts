import { describe, expect, it } from "vitest";
import { SAMPLE_ACCOUNTS, SAMPLE_AS_OF } from "./sampleData";
import { gapScore, inWindow, intentScore, scoreAccounts, selectOutreachList, tierFor } from "./scoring";
import type { ScoredAccount, Signal } from "./types";

const signal = (kind: Signal["kind"], filedAt = "2026-06-01"): Signal => ({
  kind,
  summary: kind,
  form: "8-K",
  filedAt,
  source: "massive",
});

describe("scoring", () => {
  it("only counts signals from the trailing 12 months", () => {
    expect(inWindow(signal("ai_commitment", "2025-10-16"), SAMPLE_AS_OF)).toBe(true);
    expect(inWindow(signal("ai_commitment", "2025-10-14"), SAMPLE_AS_OF)).toBe(false);
    expect(inWindow(signal("ai_commitment", "2026-10-16"), SAMPLE_AS_OF)).toBe(false);
  });

  it("caps repeated intent signals", () => {
    const commitments = [1, 2, 3, 4].map(() => signal("ai_commitment"));
    expect(intentScore(commitments)).toBe(50);
  });

  it("scores gap from pilots and ambition without results", () => {
    expect(gapScore([signal("ai_pilot_no_results"), signal("ai_commitment")])).toBe(60);
    expect(gapScore([signal("ai_commitment"), signal("ai_scaled_results")])).toBe(0);
  });

  it("maps totals to tiers", () => {
    expect(tierFor(65)).toBe(1);
    expect(tierFor(64)).toBe(2);
    expect(tierFor(44)).toBe(3);
  });

  it("excludes accounts with no connection and ranks the rest", () => {
    const ranked = scoreAccounts(SAMPLE_ACCOUNTS, SAMPLE_AS_OF);
    expect(ranked.find((a) => a.company.name === "Kestrel Bay Media")).toBeUndefined();
    expect(ranked.map((a) => a.rank)).toEqual(ranked.map((_, i) => i + 1));
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].scores.total).toBeGreaterThanOrEqual(ranked[i].scores.total);
    }
  });

  it("demotes companies already publishing scaled AI results", () => {
    const ranked = scoreAccounts(SAMPLE_ACCOUNTS, SAMPLE_AS_OF);
    const quillmark = ranked.find((a) => a.company.name === "Quillmark Insurance Holdings")!;
    expect(quillmark.demoted).toBe(true);
    expect(quillmark.tier).toBe(3);
  });

  it("drops out-of-window signals and uses the latest trigger for why-now", () => {
    const ranked = scoreAccounts(SAMPLE_ACCOUNTS, SAMPLE_AS_OF);
    const ostrander = ranked.find((a) => a.company.name === "Ostrander Materials")!;
    expect(ostrander.signals).toHaveLength(0);
    const corvane = ranked.find((a) => a.company.name === "Corvane Health Partners")!;
    expect(corvane.whyNow?.filedAt).toBe("2026-09-22");
    expect(corvane.tier).toBe(1);
  });

  it("picks the most senior connection as the warm path", () => {
    const ranked = scoreAccounts(SAMPLE_ACCOUNTS, SAMPLE_AS_OF);
    const halverson = ranked.find((a) => a.company.name === "Halverson Freight Group")!;
    expect(halverson.warmPath?.name).toBe("Dana Whitcomb");
  });
});

describe("selectOutreachList", () => {
  const fake = (tier: 1 | 2 | 3, n: number) =>
    Array.from({ length: n }, () => ({ tier }) as ScoredAccount);

  it("takes Tier 1 first, fills with Tier 2, never Tier 3, and caps at max", () => {
    const list = selectOutreachList([...fake(1, 30), ...fake(2, 90), ...fake(3, 10)]);
    expect(list).toHaveLength(100);
    expect(list.filter((a) => a.tier === 1)).toHaveLength(30);
    expect(list.some((a) => a.tier === 3)).toBe(false);
  });
});
