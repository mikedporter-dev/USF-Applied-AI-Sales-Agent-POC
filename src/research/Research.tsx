import { type FormEvent, useState } from "react";
import { Logo, ScoreBar, TierPill, formatDate, formatRevenue, signalLabel } from "../components/ui";
import type { RecordedSignal, ResearchEvent, ResearchResult } from "../shared/research";

type Step = Extract<ResearchEvent, { type: "status" | "tool" | "rejected" }>;

/** Read the agent's newline-delimited JSON stream, calling onEvent for each event. */
async function streamEvents(res: Response, onEvent: (e: ResearchEvent) => void) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

export function Research() {
  const [ticker, setTicker] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [signals, setSignals] = useState<RecordedSignal[]>([]);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (e: FormEvent) => {
    e.preventDefault();
    const symbol = ticker.trim().toUpperCase();
    if (!symbol || running) return;
    setRunning(true);
    setSteps([]);
    setSignals([]);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: symbol }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      await streamEvents(res, (event) => {
        if (event.type === "signal") setSignals((s) => [...s, event.signal]);
        else if (event.type === "result") setResult(event.result);
        else if (event.type === "error") setError(event.message);
        else setSteps((s) => [...s, event]);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rs">
      <header className="ws-top">
        <div className="ws-top-left">
          <a href="/" aria-label="Inroad home">
            <Logo />
          </a>
          <span className="ws-crumb">Research</span>
        </div>
        <div className="ws-top-right">
          <a className="btn btn-ghost btn-sm" href="/app/">
            Accounts
          </a>
        </div>
      </header>

      <main className="rs-main">
        <h1>Research a company</h1>
        <p className="rs-lede">
          The research agent reads the last 12 months of SEC filings, decides what to follow up, and records only
          evidence it can quote. The score uses the app's own rules.
        </p>

        <form className="rs-form" onSubmit={run}>
          <input
            className="rs-input"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="Ticker, e.g. CL"
            aria-label="Ticker"
            maxLength={10}
            autoCapitalize="characters"
            spellCheck={false}
            disabled={running}
          />
          <button className="btn btn-primary btn-lg" disabled={running || !ticker.trim()}>
            {running ? "Researching…" : "Research"}
          </button>
        </form>
        {error && (
          <p className="rs-error" role="alert">
            {error}
          </p>
        )}

        {(steps.length > 0 || result) && (
          <div className="rs-grid">
            <section className="rs-panel" aria-label="Agent activity">
              <span className="label">Agent activity</span>
              <ol className="rs-steps">
                {steps.map((s, i) => (
                  <li key={i} className={`rs-step rs-step-${s.type}`}>
                    {s.type === "status" && s.message}
                    {s.type === "tool" && (
                      <>
                        <code>{s.name}</code> {s.detail}
                      </>
                    )}
                    {s.type === "rejected" && (
                      <>
                        Rejected <code>{s.tool}</code>: {s.reason}
                        {s.attempted && <q className="rs-attempted">{s.attempted}</q>}
                      </>
                    )}
                  </li>
                ))}
                {running && <li className="rs-step rs-step-live">Working…</li>}
              </ol>
            </section>

            <section className="rs-panel" aria-label="Findings">
              {result && <ResultCard result={result} />}
              <span className="label">{result ? "Evidence" : "Evidence so far"}</span>
              <EvidenceList signals={result?.signals ?? signals} />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function ResultCard({ result: r }: { result: ResearchResult }) {
  const caveats = [
    "Not in your network yet: the app only ranks companies where you have a Manager+ connection.",
    "S&P Composite 1500 membership wasn't checked.",
    r.usedEdgar ? null : "SEC EDGAR isn't configured, so 10-Q MD&A and 8-K exhibits weren't read.",
    r.facts?.revenueSource ?? "Revenue wasn't found in SEC data, so the Fit score treats the company as small.",
    r.facts?.sectorSource
      ? `Sector: ${r.facts?.sectorSource}. An approximation until the S&P 1500 list supplies the GICS sector.`
      : "No sector could be mapped from the SIC code, so Fit uses the default industry weight.",
    r.stopReason === "step_limit" ? "The agent hit its turn limit before finishing." : null,
    r.stopReason === "model_error" ? "The model stopped answering, so research ended early with the signals recorded so far." : null,
  ].filter(Boolean);

  return (
    <div className="rs-result">
      <div className="rs-result-head">
        <div>
          <h2>{r.company.name}</h2>
          <p>
            {r.company.ticker} · CIK {r.company.cik}
            {r.company.industry ? ` · ${r.company.industry}` : ""}
            {r.company.revenueUsd ? ` · ${formatRevenue(r.company.revenueUsd)} revenue` : ""}
          </p>
        </div>
      </div>
      <div className="detail-scores">
        <div className="detail-total">
          <span className="mono">{r.scores.total}</span>
          <TierPill tier={r.tier} />
        </div>
        <div className="detail-bars">
          <ScoreBar label="Fit" value={r.scores.fit} />
          <ScoreBar label="Intent" value={r.scores.intent} />
          <ScoreBar label="Gap" value={r.scores.gap} />
        </div>
      </div>
      {r.whyRanks.length > 0 && (
        <ul className="reasons">
          {r.whyRanks.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <p>
        <strong>Why now: </strong>
        {r.whyNow ? `${r.whyNow.summary} (${r.whyNow.form}, ${formatDate(r.whyNow.filedAt)})` : "No trigger in the last 12 months."}
      </p>
      {r.summary && (
        <p className="muted">
          <strong>Agent's summary: </strong>
          {r.summary}
        </p>
      )}
      <ul className="rs-caveats">
        {caveats.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="muted">{r.nextStep}</p>
    </div>
  );
}

function EvidenceList({ signals }: { signals: RecordedSignal[] }) {
  if (signals.length === 0) return <p className="muted">No evidence recorded yet.</p>;
  return (
    <ol className="evidence">
      {signals.map((s, i) => (
        <li key={i}>
          <span className="evidence-kind">{signalLabel(s)}</span>
          <p>{s.summary}</p>
          <blockquote className="rs-quote">“{s.quote}”</blockquote>
          <span className="evidence-meta">
            <span className="chip">
              {s.form}
              {s.section ? ` · ${s.section}` : ""}
            </span>
            <span className="chip">{s.source === "massive" ? "Massive" : "SEC EDGAR"}</span>
            <span className="mono">{formatDate(s.filedAt)}</span>
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer">
                Filing ↗
              </a>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
