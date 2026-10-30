import { useEffect, useState } from "react";
import { INDEX_SOURCES, type UniverseSummary } from "../shared/universe";

/** How much of the S&P Composite 1500 is loaded. A weekly GitHub Actions job keeps it current. */
export function UniverseStatus() {
  const [summary, setSummary] = useState<UniverseSummary | null>(null);

  useEffect(() => {
    fetch("/api/universe")
      .then((r) => (r.ok ? (r.json() as Promise<UniverseSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  if (!summary?.total) {
    return (
      <p className="universe">
        <small>Not loaded yet. It's imported weekly in the background.</small>
      </p>
    );
  }
  return (
    <p className="universe">
      <strong className="mono">{summary.total.toLocaleString()}</strong> companies
      <small>
        {INDEX_SOURCES.map((s) => `${summary.byIndex[s.index] ?? 0} ${s.index.replace("S&P ", "")}`).join(" · ")}
        <br />
        {summary.withRevenue.toLocaleString()} with revenue
        {summary.importedAt ? ` · updated ${new Date(summary.importedAt).toLocaleDateString()}` : ""}
      </small>
    </p>
  );
}
