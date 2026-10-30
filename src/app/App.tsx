import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Logo, ScoreBar, TierPill, formatDate, formatRevenue, signalLabel } from "../components/ui";
import { applyApproval } from "../shared/approval";
import { SAMPLE_ACCOUNTS, SAMPLE_AS_OF } from "../shared/sampleData";
import { CONTACT_ROLE_LADDER, OUTREACH_LIST, scoreAccounts, selectOutreachList } from "../shared/scoring";
import type {
  AccountsResponse,
  ApprovalResponse,
  ApprovalStatus,
  ContactApprovalUpdate,
  HealthResponse,
  ScoredAccount,
  TargetContact,
  Tier,
} from "../shared/types";
import { UniverseImport } from "./UniverseImport";

type TierFilter = "all" | Tier;

type BriefState = { status: "loading" } | { status: "done"; text: string } | { status: "error"; message: string };

type Notice = { kind: "ok" | "error"; text: string };

const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

/** Copy every approval field explicitly: JSON drops undefined, so a spread would keep a stale approvedAt or email. */
function withApproval(contact: TargetContact, u: ContactApprovalUpdate): TargetContact {
  return { ...contact, approvalStatus: u.approvalStatus, approvedAt: u.approvedAt, emailStatus: u.emailStatus, email: u.email };
}

/** Fall back to in-browser scoring of sample data when the Worker isn't running (e.g. `vite` alone). */
function offlineSample(): AccountsResponse {
  return { source: "sample", asOf: SAMPLE_AS_OF.toISOString(), accounts: scoreAccounts(SAMPLE_ACCOUNTS, SAMPLE_AS_OF) };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export function App() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [filter, setFilter] = useState<TierFilter>("all");
  const [selectedCik, setSelectedCik] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [briefs, setBriefs] = useState<Record<string, BriefState>>({});

  useEffect(() => {
    getJson<AccountsResponse>("/api/accounts")
      .catch(() => offlineSample())
      .then((res) => {
        setData(res);
        setSelectedCik(res.accounts[0]?.company.cik ?? null);
        setIncluded(new Set(selectOutreachList(res.accounts).map((a) => a.company.cik)));
      });
    getJson<HealthResponse>("/api/health")
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const accounts = data?.accounts ?? [];
  const visible = useMemo(
    () => (filter === "all" ? accounts : accounts.filter((a) => a.tier === filter)),
    [accounts, filter],
  );
  const selected = accounts.find((a) => a.company.cik === selectedCik);
  const tierCount = (t: Tier) => accounts.filter((a) => a.tier === t).length;
  const contacts = accounts.flatMap((a) => (a.targetContact ? [a.targetContact] : []));
  const approvalCount = (s: ApprovalStatus) => contacts.filter((c) => c.approvalStatus === s).length;
  const selectedContactIds = accounts.flatMap((a) =>
    included.has(a.company.cik) && a.targetContact ? [a.targetContact.id] : [],
  );

  const toggleIncluded = (cik: string) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(cik)) next.delete(cik);
      else next.add(cik);
      return next;
    });
  };

  const openAccount = (cik: string) => {
    setSelectedCik(cik);
    setSheetOpen(true);
  };

  /** Record the seller's decision. Sample data is updated in this tab only; live data goes to Supabase. */
  const decide = async (contactIds: number[], status: ApprovalStatus) => {
    if (!data || contactIds.length === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      let updates: ContactApprovalUpdate[];
      if (data.source === "sample") {
        const now = new Date();
        updates = contacts.filter((c) => contactIds.includes(c.id)).map((c) => applyApproval(c, status, now));
      } else {
        const res = await getJson<ApprovalResponse>("/api/contacts/approval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactIds, status }),
        });
        updates = res.contacts;
      }
      const byId = new Map(updates.map((u) => [u.id, u]));
      setData((d) =>
        d && {
          ...d,
          accounts: d.accounts.map((a) => {
            const u = a.targetContact && byId.get(a.targetContact.id);
            return u && a.targetContact ? { ...a, targetContact: withApproval(a.targetContact, u) } : a;
          }),
        },
      );
      const n = updates.length;
      setNotice({
        kind: "ok",
        text:
          `${status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Reset"} ${n} contact${n === 1 ? "" : "s"}.` +
          (data.source === "sample" ? " Sample data, so this isn't saved." : ""),
      });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Couldn't save the approval." });
    } finally {
      setSaving(false);
    }
  };

  const draftBrief = async (cik: string) => {
    setBriefs((b) => ({ ...b, [cik]: { status: "loading" } }));
    try {
      const { brief } = await getJson<{ brief: string }>(`/api/accounts/${cik}/brief`, { method: "POST" });
      setBriefs((b) => ({ ...b, [cik]: { status: "done", text: brief } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't draft a brief.";
      setBriefs((b) => ({ ...b, [cik]: { status: "error", message } }));
    }
  };

  return (
    <div className="ws">
      <header className="ws-top">
        <div className="ws-top-left">
          <a href="/" aria-label="Inroad home">
            <Logo />
          </a>
          <span className="ws-crumb">Accounts</span>
        </div>
        <div className="ws-top-right">
          {data && (
            <span className={`badge ${data.source === "sample" ? "badge-warn" : "badge-ok"}`}>
              {data.source === "sample" ? (
                <>
                  <span className="badge-long">Sample data · fictional companies</span>
                  <span className="badge-short">Sample data</span>
                </>
              ) : (
                "Live · Supabase"
              )}
            </span>
          )}
          <a className="btn btn-ghost btn-sm" href="/research/">
            Research a company
          </a>
          <a className="btn btn-ghost btn-sm" href="/">
            Home
          </a>
        </div>
      </header>

      <div className="ws-body">
        <aside className="ws-side" aria-label="Pipeline">
          <span className="label">Pipeline</span>
          <ol className="pipeline">
            <PipelineStep n={1} title="Match network" note="LinkedIn import not connected" state="pending" />
            <PipelineStep n={2} title="Read filings" note="Massive + EDGAR not connected" state="pending" />
            <PipelineStep n={3} title="Score & rank" note={`${accounts.length} accounts ranked`} state="done" />
            <PipelineStep n={4} title="Find contacts" note="Apollo not connected" state="pending" />
            <PipelineStep
              n={5}
              title="Approve & enrich"
              note={`${approvalCount("approved")} approved · ${approvalCount("pending")} pending`}
              state="active"
            />
          </ol>
          <span className="label">Integrations</span>
          <ul className="integrations">
            <Integration name="NVIDIA LLM" on={health?.integrations.nvidia} />
            <Integration name="Supabase" on={health?.integrations.supabase} />
            <Integration name="Massive" on={health?.integrations.massive} />
            <Integration name="SEC EDGAR" on={health?.integrations.edgar} />
            <Integration name="Apollo" on={false} />
          </ul>
          {health?.integrations.supabase && (
            <>
              <span className="label">S&amp;P Composite 1500</span>
              <UniverseImport />
            </>
          )}
        </aside>

        <main className="ws-main">
          <div className="ws-heading">
            <h1>Ranked accounts</h1>
            {data && <p>Signals from the 12 months ending {formatDate(data.asOf)}. Only companies where you have a Manager+ connection are scored.</p>}
          </div>

          <div className="ws-stats">
            <Stat label="Accounts ranked" value={accounts.length} />
            <Stat label="Tier 1" value={tierCount(1)} />
            <Stat label="Tier 2" value={tierCount(2)} />
            <Stat label="Approved contacts" value={approvalCount("approved")} note={`${approvalCount("pending")} pending`} />
          </div>

          <div className="tabs" role="tablist" aria-label="Filter by tier">
            {(["all", 1, 2, 3] as TierFilter[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={filter === t}
                className={filter === t ? "tab is-active" : "tab"}
                onClick={() => setFilter(t)}
              >
                {t === "all" ? `All ${accounts.length}` : `Tier ${t} · ${tierCount(t)}`}
              </button>
            ))}
          </div>

          {!data ? (
            <p className="empty">Loading accounts…</p>
          ) : visible.length === 0 ? (
            <p className="empty">No accounts in this tier.</p>
          ) : (
            <div className="rows" role="list">
              <div className="row row-head" aria-hidden="true">
                <span />
                <span>#</span>
                <span>Account</span>
                <span>Why now</span>
                <span>Warm path</span>
                <span>Target</span>
                <span className="num">Score</span>
              </div>
              {visible.map((a) => (
                <AccountRow
                  key={a.company.cik}
                  account={a}
                  active={a.company.cik === selectedCik}
                  included={included.has(a.company.cik)}
                  onOpen={() => openAccount(a.company.cik)}
                  onToggle={() => toggleIncluded(a.company.cik)}
                />
              ))}
            </div>
          )}
        </main>

        <section className={sheetOpen ? "ws-detail is-open" : "ws-detail"} aria-label="Account detail">
          {selected ? (
            <AccountDetail
              account={selected}
              brief={briefs[selected.company.cik]}
              saving={saving}
              onDecide={(status) => selected.targetContact && decide([selected.targetContact.id], status)}
              onDraftBrief={() => draftBrief(selected.company.cik)}
              onClose={() => setSheetOpen(false)}
            />
          ) : (
            <p className="empty">Select an account.</p>
          )}
        </section>
      </div>

      <footer className="approve-bar">
        <span role="status" className={notice?.kind === "error" ? "approve-error" : undefined}>
          {notice ? (
            notice.text
          ) : (
            <>
              <strong className="mono">{selectedContactIds.length}</strong> contact
              {selectedContactIds.length === 1 ? "" : "s"} selected
              <span className="approve-hint">
                {" "}
                · emails are enriched only after approval, for the top {OUTREACH_LIST.min}–{OUTREACH_LIST.max} accounts
              </span>
            </>
          )}
        </span>
        <span className="approve-actions">
          <button
            className="btn btn-ghost"
            disabled={saving || selectedContactIds.length === 0}
            onClick={() => decide(selectedContactIds, "rejected")}
          >
            Reject
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || selectedContactIds.length === 0}
            onClick={() => decide(selectedContactIds, "approved")}
          >
            {saving ? "Saving…" : "Approve selected"}
          </button>
        </span>
      </footer>
    </div>
  );
}

function PipelineStep(props: { n: number; title: string; note: string; state: "done" | "active" | "pending" }) {
  return (
    <li className={`step step-${props.state}`}>
      <span className="step-dot mono">{props.state === "done" ? "✓" : props.n}</span>
      <span>
        <strong>{props.title}</strong>
        <small>{props.note}</small>
      </span>
    </li>
  );
}

function Integration({ name, on }: { name: string; on: boolean | undefined }) {
  return (
    <li>
      <span className={on ? "dot dot-on" : "dot"} />
      {name}
      <small>{on ? "Connected" : "Not connected"}</small>
    </li>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="ws-stat">
      <span className="stat-label">{label}</span>
      <span className="ws-stat-value mono">{value}</span>
      {note && <span className="stat-label">{note}</span>}
    </div>
  );
}

function AccountRow(props: {
  account: ScoredAccount;
  active: boolean;
  included: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { account: a } = props;
  return (
    <div className={props.active ? "row is-active" : "row"} role="listitem">
      <input
        type="checkbox"
        checked={props.included}
        onChange={props.onToggle}
        aria-label={`Select ${a.company.name}`}
        title="Select for approval"
      />
      <span className="mono row-rank">{String(a.rank).padStart(2, "0")}</span>
      <button className="row-main" onClick={props.onOpen}>
        <span className="row-name">
          <strong>{a.company.name}</strong>
          <TierPill tier={a.tier} />
        </span>
        <small>
          {a.company.ticker} · {a.company.industry}
        </small>
      </button>
      <span className="row-cell" data-label="Why now">
        {a.whyNow ? (
          <>
            {signalLabel(a.whyNow)}
            <small>{formatDate(a.whyNow.filedAt)}</small>
          </>
        ) : (
          <small>No recent trigger</small>
        )}
      </span>
      <span className="row-cell" data-label="Warm path">
        {a.warmPath?.name}
        <small>{a.warmPath?.title}</small>
      </span>
      <span className="row-cell" data-label="Target">
        {a.targetContact ? (
          <>
            {a.targetContact.title}
            <small>{a.targetContact.name}</small>
            <ApprovalPill status={a.targetContact.approvalStatus} />
          </>
        ) : (
          <small>Not searched yet</small>
        )}
      </span>
      <span className="mono row-score">{a.scores.total}</span>
    </div>
  );
}

function AccountDetail(props: {
  account: ScoredAccount;
  brief: BriefState | undefined;
  saving: boolean;
  onDecide: (status: ApprovalStatus) => void;
  onDraftBrief: () => void;
  onClose: () => void;
}) {
  const { account: a, brief } = props;
  const signals = [...a.signals].sort((x, y) => y.filedAt.localeCompare(x.filedAt));
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <span className="mono detail-rank">#{a.rank}</span>
          <h2>{a.company.name}</h2>
          <p>
            {a.company.ticker} · {a.company.index} · {a.company.industry} · {formatRevenue(a.company.revenueUsd)}{" "}
            revenue
          </p>
        </div>
        <button className="btn btn-ghost btn-sm detail-close" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="detail-scores">
        <div className="detail-total">
          <span className="mono">{a.scores.total}</span>
          <TierPill tier={a.tier} />
        </div>
        <div className="detail-bars">
          <ScoreBar label="Fit" value={a.scores.fit} />
          <ScoreBar label="Intent" value={a.scores.intent} />
          <ScoreBar label="Gap" value={a.scores.gap} />
        </div>
      </div>

      <DetailBlock title="Why it ranks">
        {a.whyRanks.length ? (
          <ul className="reasons">
            {a.whyRanks.map((r) => (
              <li key={r} className={r.startsWith("Demoted") ? "is-demoted" : undefined}>
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No qualifying signals in the window.</p>
        )}
      </DetailBlock>

      <DetailBlock title="Why now">
        {a.whyNow ? <p>{a.whyNow.summary}</p> : <p className="muted">No trigger event in the last 12 months.</p>}
      </DetailBlock>

      <DetailBlock title="Who can get you in">
        {a.connections.map((c) => (
          <p key={c.name} className="person">
            <strong>{c.name}</strong>
            <span>
              {c.title} · {c.seniority}
            </span>
          </p>
        ))}
      </DetailBlock>

      <DetailBlock title="Who you're trying to reach">
        {a.targetContact ? (
          <>
            <p className="person">
              <strong>{a.targetContact.name}</strong>
              <span>
                {a.targetContact.title} · ladder step {a.targetContact.ladderRank + 1} of {CONTACT_ROLE_LADDER.length}
              </span>
            </p>
            <div className="approval">
              <ApprovalPill status={a.targetContact.approvalStatus} />
              <span className="muted">
                {a.targetContact.approvedAt
                  ? `on ${formatDate(a.targetContact.approvedAt)}`
                  : a.targetContact.approvalStatus === "pending"
                    ? "Email can't be enriched until approved"
                    : "Won't be enriched"}
              </span>
            </div>
            <span className="chip">
              {a.targetContact.emailStatus === "enriched" ? a.targetContact.email : "Email not enriched"}
            </span>
            <div className="approval-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={props.saving || a.targetContact.approvalStatus === "approved"}
                onClick={() => props.onDecide("approved")}
              >
                Approve
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={props.saving || a.targetContact.approvalStatus === "rejected"}
                onClick={() => props.onDecide("rejected")}
              >
                Reject
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Apollo search hasn't run for this account.</p>
        )}
      </DetailBlock>

      <DetailBlock title={`Evidence · ${signals.length} signal${signals.length === 1 ? "" : "s"}`}>
        <ol className="evidence">
          {signals.map((s, i) => (
            <li key={i}>
              <span className="evidence-kind">{signalLabel(s)}</span>
              <p>{s.summary}</p>
              <span className="evidence-meta">
                <span className="chip">
                  {s.form}
                  {s.section ? ` · ${s.section}` : ""}
                </span>
                <span className="chip">{s.source === "massive" ? "Massive" : "SEC EDGAR"}</span>
                <span className="mono">{formatDate(s.filedAt)}</span>
              </span>
            </li>
          ))}
        </ol>
      </DetailBlock>

      <DetailBlock title="Outreach angle">
        {brief?.status === "done" ? (
          <p className="brief">{brief.text}</p>
        ) : brief?.status === "error" ? (
          <p className="muted">{brief.message}</p>
        ) : (
          <p className="muted">Drafted by the NVIDIA LLM from the evidence above only.</p>
        )}
        <button className="btn btn-ghost btn-sm" onClick={props.onDraftBrief} disabled={brief?.status === "loading"}>
          {brief?.status === "loading" ? "Drafting…" : brief?.status === "done" ? "Redraft" : "Draft outreach angle"}
        </button>
      </DetailBlock>
    </div>
  );
}

function ApprovalPill({ status }: { status: ApprovalStatus }) {
  return <span className={`approval-pill approval-${status}`}>{APPROVAL_LABELS[status]}</span>;
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="detail-block">
      <span className="label">{title}</span>
      {children}
    </div>
  );
}
