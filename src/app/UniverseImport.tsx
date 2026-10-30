import { useEffect, useState } from "react";
import {
  addRevenueFrame,
  buildUniverse,
  type Holding,
  INDEX_SOURCES,
  parseHoldingsCsv,
  parseSecTickers,
  REVENUE_TAGS,
  REVENUE_YEARS,
  type Revenue,
  SAVE_BATCH,
  type UniverseSummary,
} from "../shared/universe";
import type { IndexMembership } from "../shared/types";

type Etf = (typeof INDEX_SOURCES)[number]["etf"];

/** Fewest holdings that count as a complete file for each index (they hold ~500, ~400, ~600). */
const MIN_HOLDINGS: Record<Etf, number> = { IVV: 450, IJH: 350, IJR: 500 };
/** Don't save an import that matched far fewer companies than the 1,500 expected. */
const MIN_COMPANIES = 1200;

async function source(name: string): Promise<Response> {
  const res = await fetch(`/api/universe/source/${name}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${name}: HTTP ${res.status}`);
  }
  return res;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/**
 * Import the S&P Composite 1500: iShares holdings for each index, matched to SEC
 * CIKs and revenue. The browser does the parsing; the Worker passes the files
 * through and saves the result. If an iShares file can't be fetched, the seller
 * downloads it from iShares and uploads it here.
 */
export function UniverseImport() {
  const [summary, setSummary] = useState<UniverseSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needUpload, setNeedUpload] = useState<Etf[]>([]);
  const [uploads, setUploads] = useState<Partial<Record<Etf, string>>>({});

  const refresh = () =>
    fetch("/api/universe")
      .then((r) => (r.ok ? (r.json() as Promise<UniverseSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  useEffect(() => void refresh(), []);

  const say = (line: string) => setLog((l) => [...l, line]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setLog([]);
    try {
      const importedAt = new Date().toISOString();

      const holdings: { index: IndexMembership; holdings: Holding[] }[] = [];
      const missing: Etf[] = [];
      for (const { index, etf } of INDEX_SOURCES) {
        try {
          const text = uploads[etf] ?? (await (await source(etf)).text());
          const parsed = parseHoldingsCsv(text);
          if (parsed.holdings.length < MIN_HOLDINGS[etf]) throw new Error(`only ${parsed.holdings.length} holdings`);
          holdings.push({ index, holdings: parsed.holdings });
          say(`${index}: ${parsed.holdings.length} holdings${parsed.asOf ? ` as of ${parsed.asOf}` : ""}${uploads[etf] ? " (uploaded)" : ""}`);
        } catch (err) {
          missing.push(etf);
          say(`${index}: couldn't read the ${etf} holdings (${err instanceof Error ? err.message : "failed"})`);
        }
      }
      if (missing.length) {
        setNeedUpload(missing);
        throw new Error("Download the missing holdings files from iShares and upload them below, then import again.");
      }
      setNeedUpload([]);

      const secTickers = parseSecTickers(await (await source("sec-tickers")).json());
      say(`SEC: ${secTickers.size.toLocaleString()} tickers`);

      const revenue = new Map<string, Revenue>();
      for (const year of REVENUE_YEARS(new Date())) {
        for (const tag of REVENUE_TAGS) {
          const res = await source(`revenue/${tag}/${year}`).catch(() => undefined);
          if (res) addRevenueFrame(revenue, await res.json(), tag);
        }
      }
      say(`SEC revenue: ${revenue.size.toLocaleString()} companies with annual revenue`);

      const { rows, unmatched } = buildUniverse(holdings, secTickers, revenue);
      say(`Matched ${rows.length.toLocaleString()} companies; ${rows.filter((r) => r.revenueUsd).length.toLocaleString()} with revenue`);
      if (unmatched.length) say(`No SEC match for ${unmatched.length}: ${unmatched.map((u) => u.ticker).slice(0, 12).join(", ")}${unmatched.length > 12 ? "…" : ""}`);
      if (rows.length < MIN_COMPANIES) throw new Error(`Only ${rows.length} companies matched, far fewer than 1,500, so nothing was saved.`);

      for (let i = 0; i < rows.length; i += SAVE_BATCH) {
        await post("/api/universe", { importedAt, rows: rows.slice(i, i + SAVE_BATCH) });
        say(`Saved ${Math.min(i + SAVE_BATCH, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}`);
      }
      const { leftIndex } = await post<{ leftIndex: number }>("/api/universe/finish", { importedAt });
      if (leftIndex) say(`${leftIndex} companies from the last import have left the indexes`);
      say("Done");
      setUploads({});
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setRunning(false);
    }
  };

  const upload = (etf: Etf, file: File | undefined) => {
    if (file) void file.text().then((text) => setUploads((u) => ({ ...u, [etf]: text })));
  };

  return (
    <div className="universe">
      {summary && summary.total > 0 ? (
        <p className="universe-summary">
          <strong className="mono">{summary.total.toLocaleString()}</strong> companies
          <small>
            {INDEX_SOURCES.map((s) => `${summary.byIndex[s.index] ?? 0} ${s.index.replace("S&P ", "")}`).join(" · ")}
            <br />
            {summary.withRevenue.toLocaleString()} with revenue
            {summary.importedAt ? ` · imported ${new Date(summary.importedAt).toLocaleDateString()}` : ""}
          </small>
        </p>
      ) : (
        <p className="universe-summary">
          <small>Not imported yet.</small>
        </p>
      )}
      <button className="btn btn-ghost btn-sm" onClick={run} disabled={running}>
        {running ? "Importing…" : summary?.total ? "Refresh S&P 1500" : "Import S&P 1500"}
      </button>
      {needUpload.length > 0 && (
        <div className="universe-upload">
          {INDEX_SOURCES.filter((s) => needUpload.includes(s.etf)).map((s) => (
            <label key={s.etf}>
              <span>
                {s.index}:{" "}
                <a href={s.page} target="_blank" rel="noreferrer">
                  download {s.etf} holdings
                </a>{" "}
                (in the fund page's Holdings section), then choose the file
              </span>
              <input type="file" accept=".csv,text/csv" onChange={(e) => upload(s.etf, e.target.files?.[0])} />
              {uploads[s.etf] && <small>Ready</small>}
            </label>
          ))}
        </div>
      )}
      {log.length > 0 && (
        <ol className="universe-log">
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
      {error && (
        <p className="universe-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
