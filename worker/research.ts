import {
  addToCorpus,
  type CompanyFacts,
  type Corpus,
  findPassages,
  GICS_SECTORS,
  type RecordedSignal,
  type ResearchEvent,
  type ResearchResult,
  SIGNAL_KINDS,
  FILING_FORMS,
  validateFacts,
  validateSignal,
} from "../src/shared/research";
import { CONTACT_ROLE_LADDER, scoreAccount, WINDOW_MONTHS } from "../src/shared/scoring";
import * as edgar from "./edgar";
import type { Env } from "./env";
import * as massive from "./massive";
import { type AgentMessage, chatWithTools, type ToolDefinition } from "./nvidia";

// The account research agent. The model decides which filings to read and what
// counts as evidence; code supplies the data, checks every finding against the
// text the model actually read, and scores the result with the app's own rules.

/** Model turns per run. Each turn is one NVIDIA call plus the tools it asks for. */
export const MAX_TURNS = 14;
/** EDGAR documents fetched per run, to bound time and CPU. */
const MAX_EDGAR_READS = 6;
/** Characters of text returned per read, so tool results stay a manageable size. */
const CHUNK_CHARS = 8000;

type Emit = (event: ResearchEvent) => Promise<void>;

export function isValidTicker(ticker: unknown): ticker is string {
  return typeof ticker === "string" && /^[A-Z][A-Z.\-]{0,9}$/.test(ticker);
}

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) =>
  ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
  }) satisfies ToolDefinition;

const SECTION = { type: "string", enum: ["business", "risk_factors", "mda"] };

function toolDefinitions(withEdgar: boolean): ToolDefinition[] {
  const tools = [
    fn("list_8k_filings", "List the company's 8-K filings in the window, with the Item headings each one contains.", {}),
    fn(
      "read_8k",
      "Read the item text of one 8-K (officer changes are Item 5.02, acquisitions 2.01, restructurings 2.05).",
      { accession: { type: "string", description: "accession number from list_8k_filings" } },
      ["accession"],
    ),
    fn(
      "search_10k",
      "Search one section of the latest 10-K for terms and return the passages around each match.",
      { section: SECTION, terms: { type: "array", items: { type: "string" }, description: "words or phrases to find" } },
      ["section", "terms"],
    ),
    fn(
      "read_10k",
      `Read one section of the latest 10-K in parts of about ${CHUNK_CHARS} characters, starting at part 1.`,
      { section: SECTION, part: { type: "integer", minimum: 1 } },
      ["section"],
    ),
    fn("list_new_officers", "List Form 3 filings in the window: insiders, including newly appointed officers.", {}),
  ];
  if (withEdgar) {
    tools.push(
      fn(
        "list_edgar_filings",
        "List the company's 10-Q and 8-K filings in the window from SEC EDGAR, to find quarterly MD&A and 8-K exhibits.",
        {},
      ),
      fn(
        "list_filing_documents",
        "List the documents inside one EDGAR filing, such as the main report and exhibits (ex99*.htm files are usually earnings releases or investor presentations).",
        { accession: { type: "string" } },
        ["accession"],
      ),
      fn(
        "read_edgar_document",
        `Read an EDGAR document by url. Pass terms to get matching passages, or part to read it in pieces of about ${CHUNK_CHARS} characters. Limited to ${MAX_EDGAR_READS} documents per run.`,
        {
          url: { type: "string" },
          terms: { type: "array", items: { type: "string" } },
          part: { type: "integer", minimum: 1 },
        },
        ["url"],
      ),
    );
  }
  tools.push(
    fn(
      "set_company_facts",
      "Record the company's GICS sector and, if you found it, annual revenue with a verbatim quote.",
      {
        gics_sector: { type: "string", enum: GICS_SECTORS },
        revenue_usd: { type: "number", description: "full US dollars, e.g. 20382000000 for $20,382 million" },
        revenue_quote: { type: "string", description: "exact text stating the revenue" },
        url: { type: "string", description: "url of the filing the quote came from" },
      },
      ["gics_sector"],
    ),
    fn(
      "record_signal",
      "Record one piece of evidence. The quote is checked against the text you read and rejected if it isn't there.",
      {
        kind: { type: "string", enum: SIGNAL_KINDS },
        summary: { type: "string", description: "one plain sentence a salesperson could read aloud" },
        form: { type: "string", enum: FILING_FORMS },
        section: { type: "string", description: 'e.g. "Item 1 Business", "Item 5.02", "MD&A"' },
        filed_at: { type: "string", description: "filing date, YYYY-MM-DD" },
        url: { type: "string", description: "url of the filing or document you read it in" },
        quote: { type: "string", description: "20-600 characters copied exactly from that text" },
      },
      ["kind", "summary", "form", "filed_at", "url", "quote"],
    ),
    fn("finish", "End the research with a two-sentence summary of what you found.", { summary: { type: "string" } }, [
      "summary",
    ]),
  );
  return tools;
}

function systemPrompt(windowStart: string, today: string, withEdgar: boolean): string {
  return `You research one public company for a business development leader who sells AI transformation services.
Find evidence in SEC filings from ${windowStart} to ${today} (the last ${WINDOW_MONTHS} months) and record it with record_signal.
Filings older than the window don't count.

Signal kinds:
- ai_commitment: a concrete AI investment, program, target or dated goal. Generic "we use AI" or "AI is a risk" language doesn't count.
- leadership_change: a new or departing officer (8-K Item 5.02, Form 3). Directors are not officers.
- acquisition: a completed acquisition (8-K Item 2.01).
- restructuring: a restructuring or reorganization (8-K Item 2.05, or described in a filing).
- ai_reorg: a restructuring explicitly tied to AI.
- ai_pilot_no_results: an AI pilot or experiment with no reported outcome.
- ai_scaled_results: AI running at scale with reported results. This lowers the company's priority, so record it when you see it.

How to work:
- Start broad: list the 8-Ks and new officers, and search the 10-K for AI language (terms like "artificial intelligence", "AI", "machine learning", "generative", "automation", "pilot").${
    withEdgar
      ? `
- Use EDGAR for what Massive lacks: 10-Q MD&A, and 8-K exhibits such as earnings releases and investor presentations. You can read ${MAX_EDGAR_READS} EDGAR documents, so choose them.`
      : ""
  }
- Follow leads. If a filing mentions an AI pilot, look for whether later filings report results.
- Record one signal per distinct fact; don't split one announcement into several.
- Copy each quote exactly from text a tool returned to you. A rejected signal tells you why; fix it and try again.
- Call set_company_facts once with the GICS sector and, if you can find it in a filing, total annual revenue (usually in MD&A).
- When you've covered the 8-Ks, new officers and the 10-K's AI language, call finish. Don't speculate beyond the filings.
You have ${MAX_TURNS} turns.`;
}

const ok = (value: unknown) => JSON.stringify(value);
const fail = (message: string) => JSON.stringify({ error: message });

/** Run the agent for one ticker, streaming progress through `emit`. */
export async function runResearch(env: Env, ticker: string, emit: Emit, now = new Date()): Promise<ResearchResult> {
  const today = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - WINDOW_MONTHS);
  const windowStart = start.toISOString().slice(0, 10);
  const withEdgar = edgar.isConfigured(env);

  await emit({ type: "status", message: `Looking up ${ticker}` });
  const profile = await massive.companyProfile(env, ticker);
  await emit({
    type: "status",
    message: `${profile.name} · CIK ${profile.cik}${withEdgar ? "" : " · SEC EDGAR not configured, using Massive only"}`,
  });

  const corpus: Corpus = new Map();
  const signals: RecordedSignal[] = [];
  let facts: CompanyFacts | undefined;
  let summary: string | undefined;
  let edgarReads = 0;

  // Each dataset is fetched at most once per run.
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T>;
  };
  const eightKs = () => once("8k", () => massive.eightKs(env, ticker, windowStart));
  const tenK = () => once("10k", () => massive.tenKSections(env, ticker, windowStart));
  const edgarDocText = (url: string) => once(`doc:${url}`, () => edgar.documentText(env, url));

  async function tenKSection(section: string) {
    const sections = await tenK();
    return sections.find((s) => s.section === section);
  }

  async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "list_8k_filings": {
        const list = await eightKs();
        await emit({ type: "tool", name, detail: `${list.length} 8-K filings` });
        return ok(
          list.map((f) => ({
            accession: f.accession,
            filing_date: f.filingDate,
            form: f.formType,
            items: f.text.match(/Item \d+\.\d+\.?[^\n]{0,90}/g)?.slice(0, 6) ?? [],
          })),
        );
      }
      case "read_8k": {
        const filing = (await eightKs()).find((f) => f.accession === args.accession);
        if (!filing) return fail("No 8-K with that accession in the window.");
        const text = filing.text.slice(0, CHUNK_CHARS * 2);
        addToCorpus(corpus, filing.url, text, "massive");
        await emit({ type: "tool", name, detail: `8-K filed ${filing.filingDate}` });
        return ok({ filing_date: filing.filingDate, url: filing.url, text });
      }
      case "search_10k": {
        const sec = await tenKSection(String(args.section));
        if (!sec) return fail("No 10-K section like that in the window.");
        const terms = Array.isArray(args.terms) ? args.terms.map(String) : [];
        const passages = findPassages(sec.text, terms);
        for (const p of passages) addToCorpus(corpus, sec.url, p, "massive");
        await emit({ type: "tool", name, detail: `10-K ${sec.section}: "${terms.join('", "')}" → ${passages.length} passages` });
        return ok({ filing_date: sec.filingDate, url: sec.url, passages });
      }
      case "read_10k": {
        const sec = await tenKSection(String(args.section));
        if (!sec) return fail("No 10-K section like that in the window.");
        const part = Math.max(1, Number(args.part) || 1);
        const parts = Math.max(1, Math.ceil(sec.text.length / CHUNK_CHARS));
        const text = sec.text.slice((part - 1) * CHUNK_CHARS, part * CHUNK_CHARS);
        addToCorpus(corpus, sec.url, text, "massive");
        await emit({ type: "tool", name, detail: `10-K ${sec.section}, part ${part} of ${parts}` });
        return ok({ filing_date: sec.filingDate, url: sec.url, part, parts, text });
      }
      case "list_new_officers": {
        const list = await once("form3", () => massive.form3s(env, profile.cik, windowStart));
        for (const f of list) {
          addToCorpus(corpus, f.url, `${f.ownerName}; ${f.officerTitle ?? "not an officer"}; filed ${f.filingDate}`, "massive");
        }
        await emit({ type: "tool", name, detail: `${list.length} Form 3 filings` });
        return ok(list.map((f) => ({ filing_date: f.filingDate, owner: f.ownerName, officer_title: f.officerTitle, is_officer: f.isOfficer, url: f.url })));
      }
      case "list_edgar_filings": {
        const list = await once("edgar", () => edgar.recentFilings(env, profile.cik, ["10-Q", "8-K"], windowStart));
        await emit({ type: "tool", name, detail: `${list.length} 10-Q and 8-K filings on EDGAR` });
        return ok(list.map((f) => ({ form: f.form, filing_date: f.filingDate, accession: f.accession, main_document: `${f.folderUrl}/${f.primaryDocument}` })));
      }
      case "list_filing_documents": {
        const docs = await edgar.filingDocuments(env, profile.cik, String(args.accession));
        await emit({ type: "tool", name, detail: `${docs.length} documents in ${args.accession}` });
        return ok(docs);
      }
      case "read_edgar_document": {
        const url = String(args.url);
        if (!cache.has(`doc:${url}`)) {
          if (edgarReads >= MAX_EDGAR_READS) return fail(`You've used all ${MAX_EDGAR_READS} EDGAR document reads.`);
          edgarReads++;
        }
        const text = await edgarDocText(url);
        const terms = Array.isArray(args.terms) ? args.terms.map(String) : [];
        const name_ = url.split("/").pop();
        if (terms.length) {
          const passages = findPassages(text, terms);
          for (const p of passages) addToCorpus(corpus, url, p, "edgar");
          await emit({ type: "tool", name, detail: `${name_}: "${terms.join('", "')}" → ${passages.length} passages` });
          return ok({ url, passages });
        }
        const part = Math.max(1, Number(args.part) || 1);
        const parts = Math.max(1, Math.ceil(text.length / CHUNK_CHARS));
        const chunk = text.slice((part - 1) * CHUNK_CHARS, part * CHUNK_CHARS);
        addToCorpus(corpus, url, chunk, "edgar");
        await emit({ type: "tool", name, detail: `${name_}, part ${part} of ${parts}` });
        return ok({ url, part, parts, text: chunk });
      }
      case "set_company_facts": {
        const result = validateFacts(args, corpus);
        if (typeof result === "string") {
          await emit({ type: "rejected", tool: name, reason: result });
          return fail(result);
        }
        facts = result;
        await emit({
          type: "tool",
          name,
          detail: `${result.gicsSector}${result.revenueUsd ? ` · revenue $${(result.revenueUsd / 1e9).toFixed(1)}B` : ""}`,
        });
        return ok({ recorded: true });
      }
      case "record_signal": {
        const result = validateSignal(args, corpus, now);
        if (typeof result === "string") {
          await emit({ type: "rejected", tool: name, reason: result });
          return fail(result);
        }
        signals.push(result);
        await emit({ type: "signal", signal: result });
        return ok({ recorded: true, total: signals.length });
      }
      default:
        return fail(`Unknown tool ${name}.`);
    }
  }

  const tools = toolDefinitions(withEdgar);
  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt(windowStart, today, withEdgar) },
    {
      role: "user",
      content: `Research ${profile.name} (${profile.ticker}), SEC CIK ${profile.cik}.
Massive reports: industry "${profile.sicDescription ?? "unknown"}" (SIC), ${profile.employees ?? "unknown"} employees.`,
    },
  ];

  let stopReason: ResearchResult["stopReason"] = "step_limit";
  for (let turn = 1; turn <= MAX_TURNS && !summary; turn++) {
    await emit({ type: "status", message: `Thinking (turn ${turn} of ${MAX_TURNS})` });
    const reply = await chatWithTools(env, messages, tools, { maxTokens: 6144 });

    if (reply.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: reply.content || "(no answer)" });
      messages.push({ role: "user", content: "Continue by calling a tool. Call finish when you're done." });
      continue;
    }

    messages.push({ role: "assistant", content: reply.content || null, tool_calls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      let args: Record<string, unknown> = {};
      let result: string;
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      if (call.function.name === "finish") {
        summary = typeof args.summary === "string" ? args.summary : "";
        stopReason = "finished";
        await emit({ type: "status", message: `Finished after ${turn} turns with ${signals.length} signals` });
        result = ok({ finished: true });
      } else {
        try {
          result = await runTool(call.function.name, args);
        } catch (err) {
          result = fail(err instanceof Error ? err.message : "Tool failed");
          await emit({ type: "rejected", tool: call.function.name, reason: err instanceof Error ? err.message : "failed" });
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  // Scoring uses the app's own rules. S&P 1500 membership isn't checked here and
  // doesn't affect the score, so index is a placeholder that is not returned.
  const scored = scoreAccount(
    {
      company: {
        cik: profile.cik,
        ticker: profile.ticker,
        name: profile.name,
        industry: facts?.gicsSector ?? "Unknown",
        index: "S&P 500",
        revenueUsd: facts?.revenueUsd ?? 0,
        employees: profile.employees ?? 0,
      },
      signals,
      connections: [],
    },
    now,
  );

  const result: ResearchResult = {
    company: {
      cik: profile.cik,
      ticker: profile.ticker,
      name: profile.name,
      industry: facts?.gicsSector,
      revenueUsd: facts?.revenueUsd,
      employees: profile.employees,
    },
    tier: scored.tier,
    scores: scored.scores,
    demoted: scored.demoted,
    whyRanks: scored.whyRanks,
    whyNow: scored.whyNow,
    signals,
    facts,
    summary,
    stopReason,
    usedEdgar: withEdgar,
    nextStep: `Find a Manager+ connection there, then the target contact: ${CONTACT_ROLE_LADDER.map((r) => r[0]).join(", then ")}.`,
  };
  await emit({ type: "result", result });
  return result;
}
