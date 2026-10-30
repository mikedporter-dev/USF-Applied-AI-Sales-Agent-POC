import { describe, expect, it } from "vitest";
import { addToCorpus, checkLeadershipRole, type Corpus, findPassages, htmlToText, validateSignal } from "./research";

const NOW = new Date("2026-10-29T12:00:00Z");
const URL_A = "https://www.sec.gov/Archives/edgar/data/1/a.txt";

const URL_B = "https://www.sec.gov/Archives/edgar/data/1/b.htm";

function corpus(): Corpus {
  const c: Corpus = new Map();
  addToCorpus(c, URL_A, "We are “leading in capabilities” such as data,\n analytics and AI across the business.", {
    source: "massive",
    filedAt: "2026-02-23",
    form: "10-K",
  });
  addToCorpus(c, URL_B, "On April 30, 2026, the Board approved an expansion of the program. Charges are now estimated at $350 to $550 million.", {
    source: "edgar",
  });
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
    [{ quote: "too short" }, "at least"],
    [{ quote: "x".repeat(1501) }, "1501 characters, over the 1500 limit"],
    [{ quote: "we will invest $1 billion in generative AI next year" }, "not found"],
  ])("rejects %j", (change, reason) => {
    const result = validateSignal({ ...valid, ...change }, corpus(), NOW);
    expect(typeof result).toBe("string");
    expect(result).toContain(reason);
  });

  it("takes url, source, filing date and form from the document the quote is in, not from the agent", () => {
    const s = validateSignal({ ...valid, url: "https://www.sec.gov/made-up.txt", filed_at: "2026-01-01", form: "8-K EX-99" }, corpus(), NOW);
    expect(s).toMatchObject({ url: URL_A, source: "massive", filedAt: "2026-02-23", form: "10-K" });

    const fromB = validateSignal(
      { ...valid, kind: "restructuring", form: "8-K", url: URL_A, filed_at: "2026-05-01", quote: "the Board approved an expansion of the program" },
      corpus(),
      NOW,
    );
    // B has no known filing date or form, so the agent's are used; url and source come from B.
    expect(fromB).toMatchObject({ url: URL_B, source: "edgar", filedAt: "2026-05-01", form: "8-K" });
  });

  it("rejects evidence from a filing older than the window, using the filing's real date", () => {
    const c = corpus();
    const OLD = "https://www.sec.gov/Archives/edgar/data/1/old.txt";
    addToCorpus(c, OLD, "We are exploring artificial intelligence across our plants.", { source: "massive", filedAt: "2025-03-05" });
    const result = validateSignal({ ...valid, url: OLD, filed_at: "2026-03-05", quote: "exploring artificial intelligence across our plants" }, c, NOW);
    expect(result).toContain("outside");
  });

  it("accepts a quote shortened with an ellipsis when every piece appears in order", () => {
    const quote = "the Board approved an expansion … estimated at $350 to $550 million";
    expect(typeof validateSignal({ ...valid, kind: "restructuring", form: "8-K", quote }, corpus(), NOW)).toBe("object");
    const outOfOrder = "estimated at $350 to $550 million ... the Board approved an expansion";
    expect(typeof validateSignal({ ...valid, quote: outOfOrder }, corpus(), NOW)).toBe("string");
  });

  it("ignores backslashes the model leaves before quotation marks", () => {
    const quote = 'We are \\"leading in capabilities\\" such as data, analytics and AI';
    expect(typeof validateSignal({ ...valid, quote }, corpus(), NOW)).toBe("object");
  });

  it("says where a near-miss quote first differs from the text", () => {
    const c: Corpus = new Map();
    addToCorpus(c, URL_A, 'As a result, on April 8, 2026, the Board of Directors of the Company (the "Board") elected Betsy Fishbone as Chief Legal Officer.', {
      source: "massive",
      filedAt: "2026-04-09",
    });
    const result = validateSignal({ ...valid, quote: "on April 8, 2026, the Board of Directors of the Company elected Betsy Fishbone" }, c, NOW);
    expect(result).toContain('matches the text up to here');
    expect(result).toContain('the company (the "board") elected');
  });

  it("says when a quote starts before the passage the agent was given", () => {
    const c: Corpus = new Map();
    addToCorpus(c, URL_A, "ing the power of best-in-class demand generation; leading in capabilities such as data and AI.", {
      source: "massive",
      filedAt: "2026-02-23",
    });
    const result = validateSignal({ ...valid, quote: "leveraging the power of best-in-class demand generation; leading in capabilities" }, c, NOW);
    expect(result).toContain("its end matches");
    expect(result).toContain('start the quote at "ing the power');
  });

  it("rejects an ellipsis that would stitch together passages far apart", () => {
    const c: Corpus = new Map();
    addToCorpus(c, URL_A, `We will not invest in new AI programs. ${"Unrelated text. ".repeat(200)} We expect strong growth in pet nutrition.`, {
      source: "massive",
      filedAt: "2026-02-23",
    });
    const stitched = "We will not invest in new AI programs ... We expect strong growth in pet nutrition";
    expect(validateSignal({ ...valid, quote: stitched }, c, NOW)).toContain("not found");
  });
});

describe("checkLeadershipRole", () => {
  const CL = "Colgate-Palmolive Company";

  it("accepts the company's own CEO, CFO and technology, data or AI leaders", () => {
    expect(checkLeadershipRole("Chief Information Officer", "The Board appointed Jane Roe as Chief Information Officer, effective June 1.", CL)).toBeUndefined();
    expect(checkLeadershipRole("Chief Executive Officer", "John Doe, Chief Executive Officer of Colgate-Palmolive, will retire.", CL)).toBeUndefined();
    expect(checkLeadershipRole("Chief Data & Analytics Officer", "named Chief Data & Analytics Officer of the Company", CL)).toBeUndefined();
  });

  it.each([
    [undefined, "elected X as Chief Legal Officer", "needs role"],
    ["Chief Legal Officer and Secretary", "elected Betsy Fishbone to the position of Chief Legal Officer and Secretary", "isn't a role that counts"],
    ["Director", "elected Christopher S. Boerner to the Colgate-Palmolive Board", "isn't a role that counts"],
    ["Executive Vice President", "currently Executive Vice President, Deputy Chief Legal Officer", "isn't a role that counts"],
    ["Chief Technology Officer", "appointed Jane Roe as Chief Data Officer", "doesn't appear in the quote"],
    // The real CL 8-K of 2026-03-12: outside CEOs joining or leaving the board.
    [
      "Chief Executive Officer",
      "elected Christopher S. Boerner, Ph.D., Board Chair and Chief Executive Officer of Bristol-Myers Squibb Company, to the Colgate-Palmolive Board",
      "title at another company",
    ],
    [
      "Chief Executive Officer",
      "in light of the demands associated with his new position as Chief Executive Officer of The Kraft Heinz Company",
      "title at another company",
    ],
  ])("rejects role %j", (role, quote, reason) => {
    expect(checkLeadershipRole(role, quote, CL)).toContain(reason);
  });

  it("is applied when a leadership_change is recorded", () => {
    const c: Corpus = new Map();
    addToCorpus(c, URL_A, "Steven A. Cahillane will not stand for reelection, in light of his new position as Chief Executive Officer of The Kraft Heinz Company.", {
      source: "massive",
      filedAt: "2026-03-12",
      form: "8-K",
    });
    const result = validateSignal(
      { ...valid, kind: "leadership_change", form: "8-K", role: "Chief Executive Officer", quote: "his new position as Chief Executive Officer of The Kraft Heinz Company" },
      c,
      NOW,
      CL,
    );
    expect(result).toContain("title at another company");
  });
});

describe("findPassages", () => {
  it("starts and ends passages on sentence boundaries", () => {
    const text = `${"Filler sentence here. ".repeat(40)}We are leading in capabilities such as AI across the business. ${"More filler text. ".repeat(40)}`;
    const [passage] = findPassages(text, ["AI across"], 200);
    expect(passage).toMatch(/^Filler sentence here\./);
    expect(passage).toMatch(/\.$/);
  });

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
