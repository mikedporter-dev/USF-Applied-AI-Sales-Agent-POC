import type { ApprovalRequest, ApprovalStatus, TargetContact } from "./types";

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = ["pending", "approved", "rejected"];

/** Upper bound on contacts per approval request (the outreach list is at most 100). */
export const MAX_APPROVAL_BATCH = 200;

/** Validate an untrusted POST /api/contacts/approval body. Returns an error message if invalid. */
export function parseApprovalRequest(body: unknown): ApprovalRequest | string {
  if (typeof body !== "object" || body === null) return "Body must be a JSON object";
  const { contactIds, status } = body as Record<string, unknown>;
  if (!APPROVAL_STATUSES.includes(status as ApprovalStatus)) {
    return `status must be one of: ${APPROVAL_STATUSES.join(", ")}`;
  }
  if (!Array.isArray(contactIds) || contactIds.length === 0 || contactIds.length > MAX_APPROVAL_BATCH) {
    return `contactIds must be a non-empty array of at most ${MAX_APPROVAL_BATCH} ids`;
  }
  if (!contactIds.every((id) => Number.isSafeInteger(id) && id > 0)) {
    return "contactIds must be positive integers";
  }
  return { contactIds: [...new Set(contactIds as number[])], status: status as ApprovalStatus };
}

export type ApprovalChange = Pick<TargetContact, "approvalStatus" | "approvedAt"> &
  Partial<Pick<TargetContact, "emailStatus" | "email">>;

/**
 * Fields that change when the seller decides on a contact. Approving stamps the
 * time and leaves enrichment alone. Anything other than approved also clears
 * the email and any enrichment result, matching the
 * target_contacts_enrichment_requires_approval constraint in
 * supabase/migrations/0002_target_contact_approval.sql.
 */
export function approvalChange(status: ApprovalStatus, now = new Date()): ApprovalChange {
  if (status === "approved") return { approvalStatus: "approved", approvedAt: now.toISOString() };
  return { approvalStatus: status, approvedAt: undefined, emailStatus: "not_enriched", email: undefined };
}

/** Apply a decision locally (used for sample data, which isn't stored anywhere). */
export function applyApproval(contact: TargetContact, status: ApprovalStatus, now = new Date()): TargetContact {
  // Re-approving keeps the original approval time.
  if (status === "approved" && contact.approvalStatus === "approved") return contact;
  return { ...contact, ...approvalChange(status, now) };
}
