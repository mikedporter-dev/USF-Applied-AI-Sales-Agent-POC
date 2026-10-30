import { describe, expect, it } from "vitest";
import { pickResearchQueue } from "./supabase";

const NOW = new Date("2026-10-30T12:00:00Z");
const count = new Map([
  ["A", 2],
  ["B", 60],
  ["C", 5],
  ["D", 9],
  ["E", 1],
]);

describe("pickResearchQueue", () => {
  it("takes never-attempted companies first by connections, then the least recently attempted, skipping fresh research", () => {
    const runs = [
      { cik: "C", finished_at: "2026-10-29T08:00:00Z", stop_reason: "finished" }, // fresh: skipped
      { cik: "D", finished_at: "2026-10-30T07:00:00Z", stop_reason: "error" }, // failed recently
      { cik: "E", finished_at: "2026-10-01T07:00:00Z", stop_reason: "finished" }, // stale: due again
    ];
    expect(pickResearchQueue(count, runs, 10, NOW)).toEqual(["B", "A", "E", "D"]);
    expect(pickResearchQueue(count, runs, 2, NOW)).toEqual(["B", "A"]);
  });

  it("counts a step-limit run as research but not a model error", () => {
    const runs = [
      { cik: "B", finished_at: "2026-10-30T07:00:00Z", stop_reason: "step_limit" },
      { cik: "A", finished_at: "2026-10-30T07:00:00Z", stop_reason: "model_error" },
    ];
    expect(pickResearchQueue(count, runs, 10, NOW)).toEqual(["D", "C", "E", "A"]);
  });
});
