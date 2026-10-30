import { INDEX_SOURCES, REVENUE_TAGS } from "../src/shared/universe";
import type { Env } from "./env";

// Source files for the S&P 1500 import. The Worker only passes them through to
// the browser, which parses them: the files are megabytes, and parsing them
// here would exceed the Worker's CPU budget. Only these fixed sources are
// allowed, so this can't be used to fetch arbitrary URLs.

const TIMEOUT_MS = 30_000;

interface Source {
  url: string;
  sec: boolean;
}

/** Resolve a source name ("IVV", "sec-tickers", "revenue/Revenues/2025") to its URL. */
export function sourceFor(name: string): Source | undefined {
  const fund = INDEX_SOURCES.find((s) => s.etf === name);
  if (fund) return { url: `${fund.page}/1467271812596.ajax?fileType=csv&fileName=${fund.etf}_holdings&dataType=fund`, sec: false };
  if (name === "sec-tickers") return { url: "https://www.sec.gov/files/company_tickers.json", sec: true };
  const revenue = name.match(/^revenue\/([A-Za-z]+)\/(\d{4})$/);
  if (revenue && (REVENUE_TAGS as readonly string[]).includes(revenue[1])) {
    return { url: `https://data.sec.gov/api/xbrl/frames/us-gaap/${revenue[1]}/USD/CY${revenue[2]}.json`, sec: true };
  }
  return undefined;
}

/** Fetch a source and stream it to the browser unparsed. */
export async function passThrough(env: Env, name: string): Promise<Response> {
  const source = sourceFor(name);
  if (!source) return Response.json({ error: `Unknown source ${name}` }, { status: 404 });
  if (source.sec && !env.SEC_USER_AGENT) {
    return Response.json({ error: "SEC data needs the SEC_USER_AGENT secret." }, { status: 503 });
  }
  const res = await fetch(source.url, {
    headers: { "User-Agent": source.sec ? env.SEC_USER_AGENT! : "Inroad sales research POC", Accept: "*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: unknown) => err as Error);
  if (res instanceof Error || !res.ok) {
    const why = res instanceof Error ? res.message : `HTTP ${res.status}`;
    return Response.json({ error: `Couldn't fetch ${name} (${why}).` }, { status: 502 });
  }
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "text/plain", "Cache-Control": "no-store" },
  });
}
