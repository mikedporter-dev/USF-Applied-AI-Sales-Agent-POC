import {
  addToCorpus,
  type CompanyFacts,
  type Corpus,
  findPassages,
  locateQuote,
  type RecordedSignal,
  type ResearchEvent,
  type ResearchResult,
  SIGNAL_KINDS,
  FILING_FORMS,
  validateSignal,
} from "../src/shared/research";
import type { FilingForm } from "../src/shared/types";
import { CONTACT_ROLE_LADDER, scoreAccount, WINDOW_MONTHS } from "../src/shared/scoring";
import { sicToGicsSector } from "../src/shared/sic";
import * as edgar from "./edgar";
import type { Env } from "./env";
import * as massive from "./massive";
import { type AgentMessage, chatWithTools, type ToolDefinition } from "./nvidia";

// The account research agent. The model decides which filings to read and what
// counts as evidence; code supplies the data and the company facts (sector,
// revenue), checks every finding against the text the model actually read, and
// scores the result with the app's own rules.

/** Model turns per run. Each turn is one NVIDIA call plus the tools it asks for. */
export const MAX_TURNS = 16;
/** Extra turns after MAX_TURNS in which the agent can only record findings and finish. */
export const WRAP_UP_TURNS = 2;
/** When this many turns are left, the agent is reminded to record what it has. */
const REMIND_AT = 4;
const WRAP_UP_TOOLS = new Set(["record_signal", "finish"]);
/** 8-K items that usually mean a signal; code checks they were covered before the agent finishes. */
const KEY_8K_ITEMS: Record<string, string> = { "2.01": "acquisition", "2.05": "restructuring", "5.02": "officer change" };
/** Characters of each key 8-K item returned with the filing list. */
const KEY_ITEM_CHARS = 2000;

/** The text of each key item in an 8-K, so the agent can record it without a separate read. */
export function keyItems(text: string): { item: string; text: string }[] {
  return text
    .split(/\n(?=Item \d\.\d\d\b)/) // item headings start a line; mid-sentence references don't
    .map((part) => ({ item: part.match(/^Item (\d\.\d\d)/)?.[1] ?? "", text: part.trim().slice(0, KEY_ITEM_CHARS) }))
    .filter((p) => p.item in KEY_8K_ITEMS);
}
/** EDGAR documents fetched per run, to bound time and CPU. */
const MAX_EDGAR_READS = 6;
/** Characters of text returned per read, so tool results stay a manageable size. */
const CHUNK_CHARS = 8000;
/** How long one model turn may take; a turn that runs over is retried once without thinking. */
const TURN_TIMEOUT_MS = 90_000;
/** Large filing text older than this many turns is replaced with a note, so each turn stays fast. */
const KEEP_FULL_TURNS = 3;
const TRIMMABLE_TOOLS = new Set(["read_8k", "read_10k", "read_edgar_document", "search_10k"]);
const TRIM_OVER_CHARS = 3000;

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
    fn(
      "list_8k_filings",
      "List the company's 8-K filings in the window with the Item headings each contains, and the full text of key items (2.01 acquisitions, 2.05 restructurings, 5.02 officer changes), which you can quote from directly.",
      {},
    ),
    fn(
      "read_8k",
      "Read all the item text of one 8-K. Key items already come with list_8k_filings, so use this for other items.",
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
      "record_signal",
      "Record one piece of evidence. The quote is checked against the text you read and rejected if it isn't there.",
      {
        kind: { type: "string", enum: SIGNAL_KINDS },
        summary: { type: "string", description: "one plain sentence a salesperson could read aloud" },
        form: { type: "string", enum: FILING_FORMS },
        section: { type: "string", description: 'e.g. "Item 1 Business", "Item 5.02", "MD&A"' },
        filed_at: { type: "string", description: "filing date, YYYY-MM-DD" },
        url: { type: "string", description: "url of the filing or document you read it in; the quote is what's checked" },
        quote: { type: "string", description: "the one or two sentences that show the signal, copied exactly" },
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
- ai_commitment: a concrete AI investment, program, target or dated goal.
- ai_mention: the company names AI as a priority, capability or focus area, but with no concrete investment, program, target or date (e.g. "leading in capabilities such as data, analytics and AI"). It counts for less. Record at most 2, the clearest. Risk-factor boilerplate ("AI may pose risks", "competitors may use AI") doesn't count.
- leadership_change: a new or departing officer who would sponsor or shape AI work: CEO, CFO, COO, president, or a technology, data, digital, AI, analytics or transformation leader (8-K Item 5.02, Form 3). Legal, HR, accounting and other officers don't count, and directors are not officers.
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
- Call several tools in one turn when they don't depend on each other, e.g. list_8k_filings, list_new_officers and search_10k together.
- Record each signal as soon as you have the evidence for it, before reading the next filing. Don't save them for the end: research stops at the turn limit, and anything unrecorded is lost.
- 8-K items map to signals: Item 5.02 is a leadership_change (for the officers listed above), 2.01 an acquisition, 2.05 a restructuring. list_8k_filings returns these items' text, so record each that qualifies straight from it, without read_8k.
- Follow leads. If a filing mentions an AI pilot, look for whether later filings report results.
- Don't repeat a search you've already run; use the passages it returned.
- Record one signal per distinct fact; don't split one announcement into several.
- Copy each quote exactly from text a tool returned to you. A rejected signal tells you why; fix it and try again.
- The company's sector and revenue are already filled in from SEC data, so don't look for them. Spend your turns on signals.
- When you've covered the 8-Ks, new officers and the 10-K's AI language, call finish. Don't speculate beyond the filings.
You have ${MAX_TURNS} turns, then a short wrap-up in which you can only record findings and finish.`;
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
  /** 10-K risk-factor text read this run: boilerplate there doesn't count as an AI mention. */
  const riskFactors: Corpus = new Map();
  const signals: RecordedSignal[] = [];
  const facts = await companyFacts(env, profile, withEdgar);
  await emit({ type: "status", message: describeFacts(facts) });
  let summary: string | undefined;
  let edgarReads = 0;
  /** Each search run this session, and the tool call whose result holds its passages. */
  const searchesRun = new Map<string, string>();
  /** Results trimmed from the conversation (by tool call id), which the agent can no longer see. */
  const trimmed = new Set<string>();
  /** The tool call being run, so a search can be tied to the result that shows it. */
  let currentCallId = "";
  /** True if this exact search already ran and its passages are still visible; repeats waste the agent's turns. */
  const repeated = (where: string, terms: string[]) => {
    const key = `${where}|${terms.map((t) => t.toLowerCase().trim()).sort().join("|")}`;
    const earlier = searchesRun.get(key);
    if (earlier !== undefined && !trimmed.has(earlier)) return true;
    searchesRun.set(key, currentCallId);
    return false;
  };
  const REPEAT_NOTE = ok({ note: "You already ran this exact search. Use the passages it returned, or record what you found." });

  // Each dataset is fetched at most once per run.
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T>;
  };
  const eightKs = () => once("8k", () => massive.eightKs(env, ticker, windowStart));
  const tenK = () => once("10k", () => massive.tenKSections(env, ticker, windowStart));
  const edgarDocText = (url: string) => once(`doc:${url}`, () => edgar.documentText(env, url));
  const edgarFilings = () => once("edgar", () => edgar.recentFilings(env, profile.cik, ["10-Q", "8-K"], windowStart));

  /**
   * 8-Ks with a key item that nothing has been recorded from. In the wrap-up the
   * agent can't read filings any more, so only the ones it already read count.
   */
  async function unrecordedKeyFilings(wrapUp: boolean): Promise<string[]> {
    const filings = await eightKs().catch(() => []);
    const out: string[] = [];
    for (const f of filings) {
      if (wrapUp && !corpus.has(f.url)) continue;
      if (signals.some((s) => s.url === f.url || s.filedAt === f.filingDate)) continue;
      const items = [...new Set(keyItems(f.text).map((k) => k.item))];
      if (items.length) {
        out.push(`${f.filingDate} (accession ${f.accession}): ${items.map((i) => `Item ${i} ${KEY_8K_ITEMS[i]}`).join(", ")}`);
      }
    }
    return out;
  }
  let coverageChecked = false;
  /** Filing date and form of an EDGAR document, from the filing folder it sits in. */
  async function edgarDocFacts(url: string) {
    const filings = await edgarFilings().catch(() => []);
    const filing = filings.find((f) => url.startsWith(`${f.folderUrl}/`));
    const name = url.split("/").pop() ?? "";
    let form: FilingForm | undefined;
    if (filing?.form === "10-Q") form = "10-Q";
    else if (filing?.form === "8-K") form = name === filing.primaryDocument ? "8-K" : /ex-?99/i.test(name) ? "8-K EX-99" : undefined;
    return { source: "edgar" as const, filedAt: filing?.filingDate, form };
  }

  /** The model sometimes names this argument accession_number; accept either. */
  const accessionArg = (args: Record<string, unknown>) => {
    const value = args.accession ?? args.accession_number;
    return typeof value === "string" && /^\d{10}-\d{2}-\d{6}$/.test(value.trim()) ? value.trim() : undefined;
  };
  const ACCESSION_HELP = fail("accession is required, like 0000021665-26-000022: copy it from list_8k_filings or list_edgar_filings.");

  function addTenK(sec: massive.TenKSection, text: string) {
    const facts = { source: "massive" as const, filedAt: sec.filingDate, form: "10-K" as const };
    addToCorpus(corpus, sec.url, text, facts);
    if (sec.section === "risk_factors") addToCorpus(riskFactors, sec.url, text, facts);
  }

  async function tenKSection(section: string) {
    const sections = await tenK();
    return sections.find((s) => s.section === section);
  }

  async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "list_8k_filings": {
        const list = await eightKs();
        const withKeyItems = list.filter((f) => keyItems(f.text).length).length;
        await emit({ type: "tool", name, detail: `${list.length} 8-K filings, ${withKeyItems} with key items` });
        return ok(
          list.map((f) => {
            const key = keyItems(f.text);
            for (const k of key) addToCorpus(corpus, f.url, k.text, { source: "massive", filedAt: f.filingDate, form: "8-K" });
            return {
              accession: f.accession,
              filing_date: f.filingDate,
              form: f.formType,
              url: f.url,
              items: f.text.match(/Item \d+\.\d+\.?[^\n]{0,90}/g)?.slice(0, 6) ?? [],
              ...(key.length ? { key_items: key.map((k) => ({ item: k.item, signal: KEY_8K_ITEMS[k.item], text: k.text })) } : {}),
            };
          }),
        );
      }
      case "read_8k": {
        const accession = accessionArg(args);
        if (!accession) return ACCESSION_HELP;
        const filing = (await eightKs()).find((f) => f.accession === accession);
        if (!filing) return fail("No 8-K with that accession in the window.");
        const text = filing.text.slice(0, CHUNK_CHARS * 2);
        addToCorpus(corpus, filing.url, text, { source: "massive", filedAt: filing.filingDate, form: "8-K" });
        await emit({ type: "tool", name, detail: `8-K filed ${filing.filingDate}` });
        return ok({ filing_date: filing.filingDate, url: filing.url, text });
      }
      case "search_10k": {
        const sec = await tenKSection(String(args.section));
        if (!sec) return fail("No 10-K section like that in the window.");
        const terms = Array.isArray(args.terms) ? args.terms.map(String) : [];
        if (repeated(sec.url + sec.section, terms)) {
          await emit({ type: "tool", name, detail: `10-K ${sec.section}: repeat search skipped` });
          return REPEAT_NOTE;
        }
        const passages = findPassages(sec.text, terms);
        for (const p of passages) addTenK(sec, p);
        await emit({ type: "tool", name, detail: `10-K ${sec.section}: "${terms.join('", "')}" → ${passages.length} passages` });
        return ok({ filing_date: sec.filingDate, url: sec.url, passages });
      }
      case "read_10k": {
        const sec = await tenKSection(String(args.section));
        if (!sec) return fail("No 10-K section like that in the window.");
        const part = Math.max(1, Number(args.part) || 1);
        const parts = Math.max(1, Math.ceil(sec.text.length / CHUNK_CHARS));
        const text = sec.text.slice((part - 1) * CHUNK_CHARS, part * CHUNK_CHARS);
        addTenK(sec, text);
        await emit({ type: "tool", name, detail: `10-K ${sec.section}, part ${part} of ${parts}` });
        return ok({ filing_date: sec.filingDate, url: sec.url, part, parts, text });
      }
      case "list_new_officers": {
        const list = await once("form3", () => massive.form3s(env, profile.cik, windowStart));
        for (const f of list) {
          addToCorpus(corpus, f.url, `${f.ownerName}; ${f.officerTitle ?? "not an officer"}; filed ${f.filingDate}`, {
            source: "massive",
            filedAt: f.filingDate,
            form: "Form 3",
          });
        }
        await emit({ type: "tool", name, detail: `${list.length} Form 3 filings` });
        return ok(list.map((f) => ({ filing_date: f.filingDate, owner: f.ownerName, officer_title: f.officerTitle, is_officer: f.isOfficer, url: f.url })));
      }
      case "list_edgar_filings": {
        const list = await edgarFilings();
        await emit({ type: "tool", name, detail: `${list.length} 10-Q and 8-K filings on EDGAR` });
        return ok(list.map((f) => ({ form: f.form, filing_date: f.filingDate, accession: f.accession, main_document: `${f.folderUrl}/${f.primaryDocument}` })));
      }
      case "list_filing_documents": {
        const accession = accessionArg(args);
        if (!accession) return ACCESSION_HELP;
        const docs = await edgar.filingDocuments(env, profile.cik, accession);
        await emit({ type: "tool", name, detail: `${docs.length} documents in ${accession}` });
        return ok(docs);
      }
      case "read_edgar_document": {
        const url = String(args.url);
        const searchTerms = Array.isArray(args.terms) ? args.terms.map(String) : [];
        if (searchTerms.length && repeated(url, searchTerms)) {
          await emit({ type: "tool", name, detail: `${url.split("/").pop()}: repeat search skipped` });
          return REPEAT_NOTE;
        }
        if (!cache.has(`doc:${url}`)) {
          if (edgarReads >= MAX_EDGAR_READS) return fail(`You've used all ${MAX_EDGAR_READS} EDGAR document reads.`);
          edgarReads++;
        }
        const text = await edgarDocText(url);
        const terms = Array.isArray(args.terms) ? args.terms.map(String) : [];
        const name_ = url.split("/").pop();
        if (terms.length) {
          const passages = findPassages(text, terms);
          const docFacts = await edgarDocFacts(url);
          for (const p of passages) addToCorpus(corpus, url, p, docFacts);
          await emit({ type: "tool", name, detail: `${name_}: "${terms.join('", "')}" → ${passages.length} passages` });
          return ok({ url, passages });
        }
        const part = Math.max(1, Number(args.part) || 1);
        const parts = Math.max(1, Math.ceil(text.length / CHUNK_CHARS));
        const chunk = text.slice((part - 1) * CHUNK_CHARS, part * CHUNK_CHARS);
        addToCorpus(corpus, url, chunk, await edgarDocFacts(url));
        await emit({ type: "tool", name, detail: `${name_}, part ${part} of ${parts}` });
        return ok({ url, part, parts, text: chunk });
      }
      case "record_signal": {
        const result =
          args.kind === "ai_mention" && typeof args.quote === "string" && locateQuote(riskFactors, args.quote)
            ? "Risk-factor language doesn't count as an ai_mention: it's boilerplate most companies share. Use the business section or MD&A."
            : validateSignal(args, corpus, now);
        if (typeof result === "string") {
          await emit({ type: "rejected", tool: name, reason: result, attempted: typeof args.quote === "string" ? args.quote : undefined });
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
Already known: ${describeFacts(facts)}; industry "${profile.sicDescription ?? "unknown"}"; ${profile.employees ?? "unknown"} employees.`,
    },
  ];

  let stopReason: ResearchResult["stopReason"] = "step_limit";

  /** Tool name for each call, so old results can be trimmed by tool. */
  const callNames = new Map<string, string>();

  /**
   * Replace large filing text the agent read more than KEEP_FULL_TURNS turns ago
   * with a short note. Every turn resends the whole conversation, so this keeps
   * turns fast. The text stays in the corpus, so quotes from it are still checked.
   */
  function trimOldResults() {
    const assistantAt = messages.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
    const cutoff = assistantAt[assistantAt.length - KEEP_FULL_TURNS];
    if (cutoff === undefined) return;
    for (let i = 0; i < cutoff; i++) {
      const m = messages[i];
      if (m.role === "tool" && (m.content?.length ?? 0) > TRIM_OVER_CHARS && TRIMMABLE_TOOLS.has(callNames.get(m.tool_call_id) ?? "")) {
        trimmed.add(m.tool_call_id);
        messages[i] = {
          ...m,
          content: ok({ note: "Text read earlier, trimmed to keep the conversation short. Call the tool again to see it; it won't be downloaded twice." }),
        };
      }
    }
  }

  /** Ask the model for its next move. A turn that times out is retried once without thinking, which is faster. */
  async function nextMove(turnTools: ToolDefinition[]) {
    try {
      return await chatWithTools(env, messages, turnTools, { maxTokens: 6144, timeoutMs: TURN_TIMEOUT_MS });
    } catch (err) {
      await emit({ type: "status", message: `${err instanceof Error ? err.message : "The model failed"}; retrying without thinking` });
      return chatWithTools(env, messages, turnTools, { maxTokens: 4096, thinking: false, timeoutMs: TURN_TIMEOUT_MS });
    }
  }

  /** One model turn: call the model, then run each tool it asks for (only `allowed` ones, if given). */
  async function takeTurn(label: string, turnTools: ToolDefinition[], allowed?: Set<string>) {
    await emit({ type: "status", message: label });
    trimOldResults();
    let reply: Awaited<ReturnType<typeof chatWithTools>>;
    try {
      reply = await nextMove(turnTools);
    } catch (err) {
      // Keep what was recorded rather than losing the whole run.
      stopReason = "model_error";
      summary = "";
      await emit({ type: "rejected", tool: "model", reason: `${err instanceof Error ? err.message : "The model failed"} twice; ending with what was recorded.` });
      return;
    }

    if (reply.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: reply.content || "(no answer)" });
      messages.push({ role: "user", content: "Continue by calling a tool. Call finish when you're done." });
      return;
    }

    messages.push({ role: "assistant", content: reply.content || null, tool_calls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      callNames.set(call.id, call.function.name);
      let args: Record<string, unknown> = {};
      let result: string;
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      if (allowed && !allowed.has(call.function.name)) {
        result = fail("Research time is up: only record_signal and finish are available.");
        await emit({ type: "rejected", tool: call.function.name, reason: "Research time is up: only record_signal and finish are available." });
      } else if (call.function.name === "finish") {
        // One reminder about uncovered 8-Ks, then the agent's judgment stands: finishing again ends the run.
        const missing = coverageChecked ? [] : await unrecordedKeyFilings(Boolean(allowed));
        coverageChecked = true;
        if (missing.length) {
          await emit({ type: "status", message: `Coverage check: ${missing.length} key 8-K${missing.length === 1 ? "" : "s"} with no signal recorded` });
          result = fail(
            `Before you finish: these 8-Ks contain items that usually mean a signal, and nothing has been recorded from them:\n- ${missing.join("\n- ")}\n` +
              `${allowed ? "Record a signal for each that qualifies, using text you already read" : "Read each one and record the signal if it qualifies"}, then call finish again. ` +
              "If one doesn't qualify (e.g. the officer isn't one of those listed in your instructions), just call finish again.",
          );
        } else {
          summary = typeof args.summary === "string" ? args.summary : "";
          stopReason = "finished";
          await emit({ type: "status", message: `Finished with ${signals.length} signal${signals.length === 1 ? "" : "s"}` });
          result = ok({ finished: true });
        }
      } else {
        try {
          currentCallId = call.id;
          result = await runTool(call.function.name, args);
        } catch (err) {
          result = fail(err instanceof Error ? err.message : "Tool failed");
          await emit({ type: "rejected", tool: call.function.name, reason: err instanceof Error ? err.message : "failed" });
        }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  for (let turn = 1; turn <= MAX_TURNS && summary === undefined; turn++) {
    await takeTurn(`Thinking (turn ${turn} of ${MAX_TURNS})`, tools);
    const left = MAX_TURNS - turn;
    if (summary === undefined && left > 0 && left <= REMIND_AT) {
      const missing = await unrecordedKeyFilings(false);
      messages.push({
        role: "user",
        content:
          `${left} turn${left === 1 ? "" : "s"} left. Record the signals you have evidence for with record_signal, then finish.` +
          (missing.length ? `\nKey 8-Ks with nothing recorded yet (record each that qualifies):\n- ${missing.join("\n- ")}` : ""),
      });
    }
  }

  // Out of turns: give the agent a short wrap-up in which it can only record what it found.
  const wrapUpTools = tools.filter((t) => WRAP_UP_TOOLS.has(t.function.name));
  for (let turn = 1; turn <= WRAP_UP_TURNS && summary === undefined; turn++) {
    messages.push({
      role: "user",
      content:
        "Research time is up. Record every signal you found evidence for with record_signal, then call finish. Only those two tools are available now.",
    });
    await takeTurn(`Wrapping up (${turn} of ${WRAP_UP_TURNS})`, wrapUpTools, WRAP_UP_TOOLS);
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

/** Sector from the SIC code and revenue from SEC XBRL: facts, so code fills them in rather than the agent. */
async function companyFacts(env: Env, profile: massive.CompanyProfile, withEdgar: boolean): Promise<CompanyFacts> {
  const facts: CompanyFacts = {};
  const sector = sicToGicsSector(profile.sicCode);
  if (sector) {
    facts.gicsSector = sector;
    facts.sectorSource = `Mapped from SIC ${profile.sicCode}${profile.sicDescription ? ` (${profile.sicDescription.toLowerCase()})` : ""}`;
  }
  if (withEdgar) {
    try {
      const revenue = await edgar.annualRevenue(env, profile.cik);
      if (revenue) {
        facts.revenueUsd = revenue.usd;
        facts.revenueSource = `SEC XBRL ${revenue.tag}, fiscal year ended ${revenue.fiscalYearEnd} (${revenue.form} filed ${revenue.filed})`;
      }
    } catch {
      // Revenue is optional: without it, Fit treats the company as small and the page says so.
    }
  }
  return facts;
}

function describeFacts(facts: CompanyFacts): string {
  const sector = facts.gicsSector ? `${facts.gicsSector} (from SIC code)` : "sector unknown";
  const revenue = facts.revenueUsd ? `revenue $${(facts.revenueUsd / 1e9).toFixed(1)}B (SEC XBRL)` : "revenue not found";
  return `${sector} · ${revenue}`;
}
