import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { approvalChange } from "../src/shared/approval";
import type { MatchedConnection, UniverseCompany } from "../src/shared/connections";
import type { RecordedSignal, ResearchResult } from "../src/shared/research";
import type { UniverseSummary } from "../src/shared/universe";
import type {
  AccountInput,
  ApprovalRequest,
  ApprovalStatus,
  ContactApprovalUpdate,
  EmailStatus,
  FilingForm,
  IndexMembership,
  Seniority,
  SignalKind,
  SignalSource,
} from "../src/shared/types";
import type { Env } from "./env";

// Row shapes for supabase/migrations/ (0001_init.sql through 0004_universe_import.sql).
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
  revenue_usd: number | null;
  employees: number | null;
  signals: {
    kind: SignalKind;
    summary: string;
    form: FilingForm;
    section: string | null;
    filed_at: string;
    source: SignalSource;
    url: string | null;
    quote: string | null;
  }[];
  research_runs: { finished_at: string; stop_reason: string }[];
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
    .select("*, signals(*), research_runs(finished_at, stop_reason), connections!inner(*), target_contacts(*)")
    .eq("in_index", true)
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
        revenueUsd: Number(row.revenue_usd ?? 0),
        employees: row.employees ?? 0,
      },
      signals: row.signals.map((s) => ({
        kind: s.kind,
        summary: s.summary,
        form: s.form,
        section: s.section ?? undefined,
        filedAt: s.filed_at,
        source: s.source,
        url: s.url ?? undefined,
        quote: s.quote ?? undefined,
      })),
      researchedAt: row.research_runs
        .filter((r) => r.stop_reason === "finished" || r.stop_reason === "step_limit")
        .map((r) => r.finished_at)
        .sort()
        .at(-1),
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

/** How many companies are in the universe now, by index. */
export async function universeSummary(env: Env): Promise<UniverseSummary> {
  const db = client(env);
  const inUniverse = () => db.from("companies").select("cik", { count: "exact", head: true }).eq("in_index", true).not("indexed_at", "is", null);
  const indexes: IndexMembership[] = ["S&P 500", "S&P MidCap 400", "S&P SmallCap 600"];
  const [total, withRevenue, latest, ...byIndex] = await Promise.all([
    inUniverse(),
    inUniverse().not("revenue_usd", "is", null),
    db.from("companies").select("indexed_at").not("indexed_at", "is", null).order("indexed_at", { ascending: false }).limit(1),
    ...indexes.map((i) => inUniverse().eq("index_membership", i)),
  ]);
  const failed = [total, withRevenue, latest, ...byIndex].find((r) => r.error);
  if (failed?.error) throw new Error(`Supabase: ${failed.error.message}`);
  return {
    total: total.count ?? 0,
    withRevenue: withRevenue.count ?? 0,
    byIndex: Object.fromEntries(indexes.map((i, n) => [i, byIndex[n].count ?? 0])) as Record<IndexMembership, number>,
    importedAt: (latest.data?.[0] as { indexed_at?: string } | undefined)?.indexed_at,
  };
}

export interface UniverseListing {
  /** Whether the S&P 1500 has been imported at all. */
  loaded: boolean;
  index?: IndexMembership;
  gicsSector?: string;
}

/** Look up one company in the imported S&P 1500, for research. */
export async function universeListing(env: Env, cik: string): Promise<UniverseListing> {
  const db = client(env);
  const [row, any] = await Promise.all([
    db.from("companies").select("industry, index_membership").eq("cik", cik.padStart(10, "0")).eq("in_index", true).not("indexed_at", "is", null).maybeSingle(),
    db.from("companies").select("cik", { count: "exact", head: true }).not("indexed_at", "is", null),
  ]);
  if (row.error || any.error) throw new Error(`Supabase: ${(row.error ?? any.error)!.message}`);
  const listed = row.data as { industry: string; index_membership: IndexMembership } | null;
  return { loaded: (any.count ?? 0) > 0, index: listed?.index_membership, gicsSector: listed?.industry };
}

/** Every company in the S&P 1500, for matching LinkedIn companies. Supabase returns at most 1,000 rows per request. */
export async function universeCompanies(env: Env): Promise<UniverseCompany[]> {
  const db = client(env);
  const out: UniverseCompany[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("companies")
      .select("cik, ticker, name, legal_name")
      .eq("in_index", true)
      .not("indexed_at", "is", null)
      .order("cik")
      .range(from, from + 999)
      .returns<{ cik: string; ticker: string; name: string; legal_name: string | null }[]>();
    if (error) throw new Error(`Supabase: ${error.message}`);
    out.push(...data.map((r) => ({ cik: r.cik, ticker: r.ticker, name: r.name, legalName: r.legal_name ?? undefined })));
    if (data.length < 1000) return out;
  }
}

/** Save one batch of a LinkedIn import, stamped with the import's start time. */
export async function saveConnections(env: Env, importedAt: string, connections: MatchedConnection[]): Promise<number> {
  const { error } = await client(env)
    .from("connections")
    .insert(
      connections.map((c) => ({
        cik: c.cik,
        name: c.name,
        title: c.title,
        seniority: c.seniority,
        connected_on: c.connectedOn ?? null,
        company_as_listed: c.companyAsListed,
        imported_at: importedAt,
      })),
    );
  if (error) throw new Error(`Supabase: ${error.message}`);
  return connections.length;
}

/** After every batch is saved, an import replaces the connections from earlier imports (and any sample data). */
export async function finishConnectionsImport(env: Env, importedAt: string): Promise<number> {
  const { count, error } = await client(env)
    .from("connections")
    .delete({ count: "exact" })
    .or(`imported_at.is.null,imported_at.lt."${importedAt}"`);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return count ?? 0;
}

/** A company that saved research checks for changed signals no more often than this. */
export const REFRESH_DAYS = 7;

export interface QueuedCompany {
  cik: string;
  ticker: string;
  name: string;
  connections: number;
}

/** Every row of a query, past Supabase's 1,000-row limit. */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Supabase: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

/**
 * Order the queue: companies never attempted first (most connections first),
 * then the least recently attempted; skip those researched successfully in the
 * last REFRESH_DAYS. Returns CIKs.
 */
export function pickResearchQueue(
  connectionCount: Map<string, number>,
  runs: { cik: string; finished_at: string; stop_reason: string }[],
  limit: number,
  now: Date,
): string[] {
  const lastAttempt = new Map<string, string>();
  const lastSuccess = new Map<string, string>();
  for (const r of runs) {
    if ((lastAttempt.get(r.cik) ?? "") < r.finished_at) lastAttempt.set(r.cik, r.finished_at);
    const ok = r.stop_reason === "finished" || r.stop_reason === "step_limit";
    if (ok && (lastSuccess.get(r.cik) ?? "") < r.finished_at) lastSuccess.set(r.cik, r.finished_at);
  }
  const fresh = new Date(now.getTime() - REFRESH_DAYS * 86_400_000).toISOString();
  return [...connectionCount.keys()]
    .filter((cik) => (lastSuccess.get(cik) ?? "") < fresh)
    .sort((a, b) => (lastAttempt.get(a) ?? "").localeCompare(lastAttempt.get(b) ?? "") || connectionCount.get(b)! - connectionCount.get(a)!)
    .slice(0, limit);
}

/**
 * The next companies to research: those with a Manager+ connection, never
 * attempted first (most connections first), then the least recently attempted.
 * Companies researched successfully in the last REFRESH_DAYS are skipped.
 */
export async function researchQueue(env: Env, limit: number, now = new Date()): Promise<QueuedCompany[]> {
  const db = client(env);
  const [connections, runs] = await Promise.all([
    allRows<{ cik: string }>((from, to) => db.from("connections").select("cik").range(from, to)),
    allRows<{ cik: string; finished_at: string; stop_reason: string }>((from, to) =>
      db.from("research_runs").select("cik, finished_at, stop_reason").range(from, to),
    ),
  ]);
  const count = new Map<string, number>();
  for (const c of connections) count.set(c.cik, (count.get(c.cik) ?? 0) + 1);
  const ciks = pickResearchQueue(count, runs, limit, now);
  if (ciks.length === 0) return [];

  const { data, error } = await db
    .from("companies")
    .select("cik, ticker, name")
    .in("cik", ciks)
    .eq("in_index", true)
    .returns<{ cik: string; ticker: string; name: string }[]>();
  if (error) throw new Error(`Supabase: ${error.message}`);
  const byCik = new Map(data.map((c) => [c.cik, c]));
  return ciks.flatMap((cik) => {
    const c = byCik.get(cik);
    return c ? [{ ...c, connections: count.get(cik)! }] : [];
  });
}

export interface ResearchRunRecord {
  cik: string;
  startedAt: string;
  model: string;
  result?: ResearchResult;
  error?: string;
}

/**
 * Record a research run. A run that finished (or used all its turns) replaces
 * the company's signals; one the model or a service cut short keeps the old ones.
 */
export async function saveResearchRun(env: Env, run: ResearchRunRecord): Promise<{ replacedSignals: boolean }> {
  const db = client(env);
  const stopReason = run.result?.stopReason ?? "error";
  const signals: RecordedSignal[] = run.result?.signals ?? [];
  const { data, error } = await db
    .from("research_runs")
    .insert({
      cik: run.cik,
      started_at: run.startedAt,
      stop_reason: stopReason,
      summary: run.result?.summary || null,
      signal_count: signals.length,
      model: run.model,
      error: run.error?.slice(0, 1000) ?? null,
    })
    .select("id")
    .single<{ id: number }>();
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (stopReason !== "finished" && stopReason !== "step_limit") return { replacedSignals: false };

  // Add the new signals, then drop the company's older ones.
  if (signals.length) {
    const { error: insertError } = await db.from("signals").insert(
      signals.map((s) => ({
        cik: run.cik,
        kind: s.kind,
        summary: s.summary,
        form: s.form,
        section: s.section ?? null,
        filed_at: s.filedAt,
        source: s.source,
        url: s.url ?? null,
        quote: s.quote,
        research_run_id: data.id,
      })),
    );
    if (insertError) throw new Error(`Supabase: ${insertError.message}`);
  }
  const { error: deleteError } = await db
    .from("signals")
    .delete()
    .eq("cik", run.cik)
    .or(`research_run_id.is.null,research_run_id.neq.${data.id}`);
  if (deleteError) throw new Error(`Supabase: ${deleteError.message}`);
  return { replacedSignals: true };
}
