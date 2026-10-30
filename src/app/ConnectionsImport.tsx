import { useState } from "react";
import {
  CONNECTION_BATCH,
  type ConnectionMatch,
  companyMatcher,
  matchConnections,
  parseConnectionsCsv,
  type UniverseCompany,
} from "../shared/connections";

const EXPORT_HELP = "https://www.linkedin.com/mypreferences/d/download-my-data";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/**
 * LinkedIn import. The seller picks their Connections.csv export; the browser
 * reads it, keeps Manager+ connections, matches their companies to the S&P 1500
 * and shows a preview. Only on Save are the matched connections sent (no emails
 * or profile links); they replace any earlier import.
 */
export function ConnectionsImport({ connectionCount, onSaved }: { connectionCount: number; onSaved: () => void }) {
  const [preview, setPreview] = useState<ConnectionMatch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDone(null);
    setPreview(null);
    setBusy("Reading your connections…");
    try {
      const connections = parseConnectionsCsv(await file.text());
      const res = await fetch("/api/universe/companies");
      const body = (await res.json()) as { companies?: UniverseCompany[]; error?: string };
      if (!res.ok || !body.companies?.length) throw new Error(body.error ?? "The S&P 1500 list isn't loaded yet.");
      setPreview(matchConnections(connections, companyMatcher(body.companies)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the file.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!preview) return;
    setError(null);
    const importedAt = new Date().toISOString();
    try {
      const all = preview.matched;
      for (let i = 0; i < all.length; i += CONNECTION_BATCH) {
        setBusy(`Saving ${Math.min(i + CONNECTION_BATCH, all.length)} of ${all.length}…`);
        await post("/api/connections", { importedAt, connections: all.slice(i, i + CONNECTION_BATCH) });
      }
      await post("/api/connections/finish", { importedAt });
      setDone(`Saved ${all.length} connections at ${new Set(all.map((m) => m.cik)).size} companies.`);
      setPreview(null);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the connections.");
    } finally {
      setBusy(null);
    }
  };

  // Matched companies, most connections first, with the names people listed.
  const byCompany = new Map<string, { listed: Set<string>; count: number }>();
  for (const m of preview?.matched ?? []) {
    const entry = byCompany.get(m.cik) ?? { listed: new Set(), count: 0 };
    entry.listed.add(m.companyAsListed);
    entry.count++;
    byCompany.set(m.cik, entry);
  }
  const topCompanies = [...byCompany.values()].sort((a, b) => b.count - a.count).slice(0, 15);

  return (
    <section className="li-import" aria-label="LinkedIn connections">
      <div className="li-head">
        <div>
          <strong>LinkedIn connections</strong>
          <p>
            {connectionCount
              ? `${connectionCount.toLocaleString()} Manager+ connections at S&P 1500 companies. Import a newer export to replace them.`
              : "Import your connections to rank the companies where you know someone."}{" "}
            Get the file from LinkedIn:{" "}
            <a href={EXPORT_HELP} target="_blank" rel="noreferrer">
              Settings → Data privacy → Get a copy of your data → Connections
            </a>
            . It's read in your browser; emails and profile links aren't saved.
          </p>
        </div>
        <label className="btn btn-ghost btn-sm li-file">
          Choose Connections.csv
          <input type="file" accept=".csv,text/csv" onChange={(e) => void read(e.target.files?.[0])} disabled={Boolean(busy)} />
        </label>
      </div>

      {busy && <p className="li-status">{busy}</p>}
      {error && (
        <p className="li-error" role="alert">
          {error}
        </p>
      )}
      {done && <p className="li-status">{done}</p>}

      {preview && (
        <div className="li-preview">
          <p>
            <strong>{preview.total.toLocaleString()}</strong> connections · <strong>{preview.managerPlus.toLocaleString()}</strong> Manager+ ·{" "}
            <strong>{preview.matched.length.toLocaleString()}</strong> at <strong>{byCompany.size}</strong> S&amp;P 1500 companies
          </p>
          <div className="li-columns">
            <div>
              <span className="label">Top matches (as listed on LinkedIn)</span>
              <ol>
                {topCompanies.map((c, i) => (
                  <li key={i}>
                    {[...c.listed].slice(0, 3).join(", ")}
                    {c.listed.size > 3 ? "…" : ""} <small>· {c.count}</small>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <span className="label">Most common companies not in the S&amp;P 1500</span>
              <ol>
                {preview.unmatchedCompanies.slice(0, 15).map((c) => (
                  <li key={c.company}>
                    {c.company} <small>· {c.count}</small>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="li-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={Boolean(busy) || preview.matched.length === 0}>
              Save {preview.matched.length.toLocaleString()} connections
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)} disabled={Boolean(busy)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
