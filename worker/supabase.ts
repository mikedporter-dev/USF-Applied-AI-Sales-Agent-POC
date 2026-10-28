import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccountInput, EmailStatus, FilingForm, Seniority, SignalKind, SignalSource } from "../src/shared/types";
import type { Env } from "./env";

// Row shapes for supabase/migrations/0001_init.sql.
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
  target_contacts: {
    name: string;
    title: string;
    ladder_rank: number;
    email_status: EmailStatus;
    email: string | null;
  }[];
}

export function isConfigured(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function client(env: Env): SupabaseClient {
  // The service-role key bypasses row-level security. It must only ever live in the Worker.
  return createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
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
        name: contact.name,
        title: contact.title,
        ladderRank: contact.ladder_rank,
        emailStatus: contact.email_status,
        email: contact.email ?? undefined,
      },
    };
  });
}
