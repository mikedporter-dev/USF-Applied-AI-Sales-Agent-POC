import { describe, expect, it } from "vitest";
import { applyApproval, parseApprovalRequest } from "./approval";
import type { TargetContact } from "./types";

const contact: TargetContact = {
  id: 1,
  name: "Priya Raman",
  title: "Chief Digital Officer",
  ladderRank: 3,
  approvalStatus: "pending",
  emailStatus: "not_enriched",
};
const now = new Date("2026-10-28T12:00:00Z");

describe("parseApprovalRequest", () => {
  it("accepts valid input and de-duplicates ids", () => {
    expect(parseApprovalRequest({ contactIds: [3, 1, 3], status: "approved" })).toEqual({
      contactIds: [3, 1],
      status: "approved",
    });
  });

  it.each([
    [null],
    [{ contactIds: [1], status: "maybe" }],
    [{ contactIds: [], status: "approved" }],
    [{ contactIds: [0], status: "approved" }],
    [{ contactIds: ["1"], status: "approved" }],
    [{ contactIds: [1.5], status: "rejected" }],
    [{ contactIds: Array.from({ length: 201 }, (_, i) => i + 1), status: "approved" }],
  ])("rejects %j", (body) => {
    expect(typeof parseApprovalRequest(body)).toBe("string");
  });
});

describe("applyApproval", () => {
  it("stamps the time on approval", () => {
    expect(applyApproval(contact, "approved", now)).toMatchObject({
      approvalStatus: "approved",
      approvedAt: "2026-10-28T12:00:00.000Z",
    });
  });

  it("keeps the original time when re-approving", () => {
    const approved = applyApproval(contact, "approved", now);
    expect(applyApproval(approved, "approved", new Date("2026-11-01"))).toBe(approved);
  });

  it("clears the timestamp and any enrichment when rejecting", () => {
    const enriched: TargetContact = {
      ...contact,
      approvalStatus: "approved",
      approvedAt: now.toISOString(),
      emailStatus: "enriched",
      email: "priya@example.com",
    };
    const rejected = applyApproval(enriched, "rejected", now);
    expect(rejected).toMatchObject({ approvalStatus: "rejected", emailStatus: "not_enriched" });
    expect(rejected.approvedAt).toBeUndefined();
    expect(rejected.email).toBeUndefined();
  });
});
