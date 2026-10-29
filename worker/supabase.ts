import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { approvalChange } from "../src/shared/approval";
import type {
  AccountInput,
  ApprovalRequest,
  ApprovalStatus,
  ContactApprovalUpdate,
  EmailStatus,
  FilingForm,
  Seniority,
  SignalKind,
  SignalSource,
} from "../src/shared/types";
import type { Env } from "./env";

// Row shapes for supabase/migrations/ (0001_init.sql + 0002_target_contact_approval.sql).
interface ContactRow {
  id: number;
  name: string;
  title: string;
  ladder_rank: number;
  approval_status: ApprovalStatus;
  approved_at: string | null;
  email_status: EmailStatus;
  email: string | null;
}

interface CompanyRow {
  cik: string;
  ticker: string;
  name: string;
  industry: string;
  index_membership: AccountInput["company"]["index"];
  revenue_usd: number;
  employees: number;
  signals: {
    kind: SignalKind;
    summary: string;
    form: FilingForm;
    section: string | null;
    filed_at: string;
    source: SignalSource;
    url: string | null;
  }[];
  connections: { name: string; title: string; seniority: Seniority; connected_on: string | null }[];
  target_contacts: ContactRow[];
}

export function isConfigured(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

function client(env: Env): SupabaseClient {
  // The secret key (sb_secret_..., or the legacy service_role key) bypasses row-level
  // security. It must only ever live in the Worker.
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
}

/** Load every company that has at least one matched connection, with its signals and contact. */
export async function loadAccountInputs(env: Env): Promise<AccountInput[]> {
  const { data, error } = await client(env)
    .from("companies")
    .select("*, signals(*), connections!inner(*), target_contacts(*)")
    .returns<CompanyRow[]>();
  if (error) throw new Error(`Supabase: ${error.message}`);

  return data.map((row) => {
    const contact = row.target_contacts.sort((a, b) => a.ladder_rank - b.ladder_rank)[0];
    return {
      company: {
        cik: row.cik,
        ticker: row.ticker,
        name: row.name,
        industry: row.industry,
        index: row.index_membership,
        revenueUsd: Number(row.revenue_usd),
        employees: row.employees,
      },
      signals: row.signals.map((s) => ({
        kind: s.kind,
        summary: s.summary,
        form: s.form,
        section: s.section ?? undefined,
        filedAt: s.filed_at,
        source: s.source,
        url: s.url ?? undefined,
      })),
      connections: row.connections.map((c) => ({
        name: c.name,
        title: c.title,
        seniority: c.seniority,
        connectedOn: c.connected_on ?? undefined,
      })),
      targetContact: contact && {
        id: contact.id,
        name: contact.name,
        title: contact.title,
        ladderRank: contact.ladder_rank,
        approvalStatus: contact.approval_status,
        approvedAt: contact.approved_at ?? undefined,
        emailStatus: contact.email_status,
        email: contact.email ?? undefined,
      },
    };
  });
}

/**
 * Record the seller's decision on target contacts. Re-approving an approved
 * contact keeps its original approval time. The database's check constraints
 * reject any write that would leave an email on a contact that isn't approved.
 */
export async function setApproval(env: Env, { contactIds, status }: ApprovalRequest): Promise<ContactApprovalUpdate[]> {
  const db = client(env);
  const change = approvalChange(status);
  const patch: Record<string, unknown> = {
    approval_status: change.approvalStatus,
    approved_at: change.approvedAt ?? null,
  };
  if (change.emailStatus) {
    patch.email_status = change.emailStatus;
    patch.email = null;
  }

  let update = db.from("target_contacts").update(patch).in("id", contactIds);
  if (status === "approved") update = update.neq("approval_status", "approved");
  const { error: updateError } = await update;
  if (updateError) throw new Error(`Supabase: ${updateError.message}`);

  const { data, error } = await db
    .from("target_contacts")
    .select("id, approval_status, approved_at, email_status, email")
    .in("id", contactIds)
    .returns<Pick<ContactRow, "id" | "approval_status" | "approved_at" | "email_status" | "email">[]>();
  if (error) throw new Error(`Supabase: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    approvalStatus: row.approval_status,
    approvedAt: row.approved_at ?? undefined,
    emailStatus: row.email_status,
    email: row.email ?? undefined,
  }));
}
