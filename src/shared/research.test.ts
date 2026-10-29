import { describe, expect, it } from "vitest";
import { addToCorpus, type Corpus, findPassages, htmlToText, validateFacts, validateSignal } from "./research";

const NOW = new Date("2026-10-29T12:00:00Z");
const URL_A = "https://www.sec.gov/Archives/edgar/data/1/a.txt";

function corpus(): Corpus {
  const c: Corpus = new Map();
  addToCorpus(c, URL_A, "We are “leading in capabilities” such as data,\n analytics and AI across the business.", "massive");
  return c;
}

const valid = {
  kind: "ai_commitment",
  summary: "Names AI leadership as a strategic priority.",
  form: "10-K",
  section: "Item 1 Business",
  filed_at: "2026-02-23",
  url: URL_A,
  quote: '"leading in capabilities" such as data, analytics and AI',
};

describe("validateSignal", () => {
  it("accepts a quote that matches ignoring case, curly quotes and line breaks", () => {
    const s = validateSignal(valid, corpus(), NOW);
    expect(typeof s).toBe("object");
    expect(s).toMatchObject({ kind: "ai_commitment", source: "massive", filedAt: "2026-02-23" });
  });

  it.each([
    [{ kind: "ai_vibes" }, "kind"],
    [{ form: "S-1" }, "form"],
    [{ filed_at: "Feb 2026" }, "filed_at"],
    [{ filed_at: "2025-01-01" }, "outside"],
    [{ url: "https://www.sec.gov/other.txt" }, "url"],
    [{ quote: "too short" }, "quote"],
    [{ quote: "we will invest $1 billion in generative AI next year" }, "not found"],
  ])("rejects %j", (change, reason) => {
    const result = validateSignal({ ...valid, ...change }, corpus(), NOW);
    expect(typeof result).toBe("string");
    expect(result).toContain(reason);
  });
});

describe("validateFacts", () => {
  it("accepts a sector alone, or revenue with a matching quote", () => {
    expect(validateFacts({ gics_sector: "Financials" }, corpus())).toEqual({ gicsSector: "Financials" });
    const c = corpus();
    addToCorpus(c, URL_A, "Net sales were $20,382 in 2025", "massive");
    expect(validateFacts({ gics_sector: "Consumer Staples", revenue_usd: 20382e6, revenue_quote: "Net sales were $20,382 in 2025", url: URL_A }, c)).toMatchObject({ revenueUsd: 20382e6 });
  });

  it("rejects an unknown sector, or revenue without a matching quote", () => {
    expect(typeof validateFacts({ gics_sector: "Crypto" }, corpus())).toBe("string");
    expect(typeof validateFacts({ gics_sector: "Financials", revenue_usd: 5e9, revenue_quote: "made lots of money", url: URL_A }, corpus())).toBe("string");
  });
});

describe("findPassages", () => {
  it("returns non-overlapping passages around each match", () => {
    const text = `${"x".repeat(2000)} artificial intelligence ${"y".repeat(2000)} AI pilot ${"z".repeat(100)}`;
    const passages = findPassages(text, ["artificial intelligence", "ai pilot"], 50);
    expect(passages).toHaveLength(2);
    expect(passages[0]).toContain("artificial intelligence");
    expect(passages[1]).toContain("AI pilot");
  });
});

describe("htmlToText", () => {
  it("strips tags and decodes entities into readable text", () => {
    const html = "<html><head><style>p{}</style></head><body><p>Net&nbsp;sales&#8217; grew &amp; we&#x2019;re</p><div>Next</div></body></html>";
    expect(htmlToText(html)).toBe("Net sales’ grew & we’re\nNext");
  });
});
