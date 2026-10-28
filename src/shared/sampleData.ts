import type { AccountInput } from "./types";

// FICTIONAL sample data so the UI works before Supabase is connected.
// Company names, people, CIKs, and filings are invented. CIKs use the 999xxxxxxx
// range, which is far above any CIK the SEC has issued.

/** Signals are dated relative to this so the sample stays inside the 12-month window. */
export const SAMPLE_AS_OF = new Date("2026-10-15T00:00:00Z");

export const SAMPLE_ACCOUNTS: AccountInput[] = [
  {
    company: {
      cik: "9990000001",
      ticker: "HLVF",
      name: "Halverson Freight Group",
      industry: "Industrials",
      index: "S&P 500",
      revenueUsd: 18.4e9,
      employees: 52000,
    },
    signals: [
      {
        kind: "ai_commitment",
        summary: "Commits $400M over three years to AI-driven route planning and yard automation.",
        form: "10-K",
        section: "Item 1 Business",
        filedAt: "2026-02-21",
        source: "massive",
      },
      {
        kind: "leadership_change",
        summary: "Appoints first Chief Digital Officer, reporting to the CEO.",
        form: "8-K",
        section: "Item 5.02",
        filedAt: "2026-08-04",
        source: "massive",
      },
      {
        kind: "ai_pilot_no_results",
        summary: "Predictive maintenance pilot at four terminals; no outcomes disclosed.",
        form: "10-Q",
        section: "MD&A",
        filedAt: "2026-07-30",
        source: "edgar",
      },
      {
        kind: "ai_pilot_no_results",
        summary: "Generative AI customer-service pilot described as \"early stage\".",
        form: "8-K EX-99",
        section: "Investor presentation",
        filedAt: "2026-05-12",
        source: "edgar",
      },
    ],
    connections: [
      { name: "Dana Whitcomb", title: "VP, Network Operations", seniority: "VP" },
      { name: "Luis Ortega", title: "Senior Manager, Procurement", seniority: "Manager" },
    ],
    targetContact: {
      name: "Priya Raman",
      title: "Chief Digital Officer",
      ladderRank: 3,
      emailStatus: "not_enriched",
    },
  },
  {
    company: {
      cik: "9990000002",
      ticker: "CVHP",
      name: "Corvane Health Partners",
      industry: "Health Care",
      index: "S&P 500",
      revenueUsd: 27.1e9,
      employees: 88000,
    },
    signals: [
      {
        kind: "ai_commitment",
        summary: "States goal to automate 30% of prior-authorization reviews with AI by 2028.",
        form: "10-K",
        section: "Item 1 Business",
        filedAt: "2026-02-27",
        source: "massive",
      },
      {
        kind: "ai_reorg",
        summary: "Consolidates analytics teams into a new Enterprise AI organization.",
        form: "8-K",
        section: "Item 2.05",
        filedAt: "2026-09-18",
        source: "massive",
      },
      {
        kind: "leadership_change",
        summary: "Names new Chief Data & Analytics Officer (Form 3 filed).",
        form: "Form 3",
        filedAt: "2026-09-22",
        source: "massive",
      },
      {
        kind: "ai_pilot_no_results",
        summary: "Clinical documentation AI in pilot across two regions; results not reported.",
        form: "10-Q",
        section: "MD&A",
        filedAt: "2026-08-06",
        source: "edgar",
      },
    ],
    connections: [{ name: "Marcus Bell", title: "Director, Revenue Cycle", seniority: "Director" }],
    targetContact: {
      name: "Elena Fischer",
      title: "Chief Data & Analytics Officer",
      ladderRank: 1,
      emailStatus: "not_enriched",
    },
  },
  {
    company: {
      cik: "9990000003",
      ticker: "BWMF",
      name: "Brightwater Mutual Financial",
      industry: "Financials",
      index: "S&P MidCap 400",
      revenueUsd: 4.2e9,
      employees: 9800,
    },
    signals: [
      {
        kind: "ai_commitment",
        summary: "Risk factors cite AI adoption by competitors as a threat to deposit growth.",
        form: "10-K",
        section: "Item 1A Risk Factors",
        filedAt: "2026-03-01",
        source: "massive",
      },
      {
        kind: "acquisition",
        summary: "Completes acquisition of a regional wealth manager.",
        form: "8-K",
        section: "Item 2.01",
        filedAt: "2026-06-30",
        source: "massive",
      },
      {
        kind: "ai_pilot_no_results",
        summary: "Earnings release mentions AI underwriting pilot without metrics.",
        form: "8-K EX-99",
        section: "Earnings release",
        filedAt: "2026-07-22",
        source: "edgar",
      },
    ],
    connections: [
      { name: "Grace Liu", title: "SVP, Commercial Banking", seniority: "VP" },
      { name: "Tom Hadley", title: "Manager, Treasury Services", seniority: "Manager" },
    ],
    targetContact: {
      name: "Owen Park",
      title: "Chief Information Officer",
      ladderRank: 2,
      emailStatus: "not_enriched",
    },
  },
  {
    company: {
      cik: "9990000004",
      ticker: "PAFD",
      name: "Pell & Ardent Foods",
      industry: "Consumer Staples",
      index: "S&P MidCap 400",
      revenueUsd: 6.8e9,
      employees: 21000,
    },
    signals: [
      {
        kind: "restructuring",
        summary: "Announces restructuring of North American supply chain.",
        form: "8-K",
        section: "Item 2.05",
        filedAt: "2026-04-15",
        source: "massive",
      },
      {
        kind: "ai_commitment",
        summary: "MD&A cites AI demand forecasting as a 2027 margin lever.",
        form: "10-Q",
        section: "MD&A",
        filedAt: "2026-08-12",
        source: "edgar",
      },
    ],
    connections: [{ name: "Nadia Shah", title: "Director, Category Strategy", seniority: "Director" }],
    targetContact: {
      name: "Ben Kowalski",
      title: "Chief Technology Officer",
      ladderRank: 2,
      emailStatus: "not_enriched",
    },
  },
  {
    company: {
      cik: "9990000005",
      ticker: "TSLE",
      name: "Tessaline Energy",
      industry: "Energy",
      index: "S&P 500",
      revenueUsd: 31.5e9,
      employees: 14500,
    },
    signals: [
      {
        kind: "ai_commitment",
        summary: "Describes AI-enabled reservoir modeling program in Business section.",
        form: "10-K",
        section: "Item 1 Business",
        filedAt: "2026-02-18",
        source: "massive",
      },
    ],
    connections: [{ name: "Ray Dominguez", title: "Manager, Field Engineering", seniority: "Manager" }],
  },
  {
    company: {
      cik: "9990000006",
      ticker: "MRPR",
      name: "Marrow Point Retail",
      industry: "Consumer Discretionary",
      index: "S&P SmallCap 600",
      revenueUsd: 1.3e9,
      employees: 7400,
    },
    signals: [
      {
        kind: "leadership_change",
        summary: "CEO departs; interim CEO named from the board.",
        form: "8-K",
        section: "Item 5.02",
        filedAt: "2026-09-03",
        source: "massive",
      },
      {
        kind: "ai_pilot_no_results",
        summary: "Personalization pilot referenced in investor day deck; no results.",
        form: "8-K EX-99",
        section: "Investor presentation",
        filedAt: "2026-06-10",
        source: "edgar",
      },
    ],
    connections: [{ name: "Chloe Abrams", title: "VP, Merchandising", seniority: "VP" }],
    targetContact: {
      name: "Sam Okafor",
      title: "Chief Information Officer",
      ladderRank: 2,
      emailStatus: "not_enriched",
    },
  },
  {
    company: {
      cik: "9990000007",
      ticker: "QLMK",
      name: "Quillmark Insurance Holdings",
      industry: "Financials",
      index: "S&P 500",
      revenueUsd: 22.9e9,
      employees: 31000,
    },
    signals: [
      {
        kind: "ai_commitment",
        summary: "Commits to AI claims triage across all personal lines.",
        form: "10-K",
        section: "Item 1 Business",
        filedAt: "2026-02-25",
        source: "massive",
      },
      {
        kind: "ai_scaled_results",
        summary: "Reports AI claims triage live on 70% of claims, cutting cycle time 35%.",
        form: "8-K EX-99",
        section: "Earnings release",
        filedAt: "2026-07-28",
        source: "edgar",
      },
    ],
    connections: [{ name: "Henry Vu", title: "Chief Actuary", seniority: "C-Suite" }],
    targetContact: {
      name: "Julia Moreno",
      title: "Chief AI Officer",
      ladderRank: 0,
      emailStatus: "not_enriched",
    },
  },
  {
    company: {
      cik: "9990000008",
      ticker: "OSTM",
      name: "Ostrander Materials",
      industry: "Materials",
      index: "S&P SmallCap 600",
      revenueUsd: 0.9e9,
      employees: 3200,
    },
    signals: [
      {
        kind: "ai_commitment",
        summary: "Older 10-K language on \"exploring AI\"; outside the 12-month window.",
        form: "10-K",
        section: "Item 1 Business",
        filedAt: "2025-03-05",
        source: "massive",
      },
    ],
    connections: [{ name: "Ivy Chen", title: "Plant Manager", seniority: "Manager" }],
  },
  {
    company: {
      cik: "9990000009",
      ticker: "KBMD",
      name: "Kestrel Bay Media",
      industry: "Communication Services",
      index: "S&P MidCap 400",
      revenueUsd: 3.6e9,
      employees: 6100,
    },
    signals: [
      {
        kind: "ai_reorg",
        summary: "Newsroom reorganization to adopt generative AI tooling.",
        form: "8-K",
        section: "Item 2.05",
        filedAt: "2026-08-20",
        source: "massive",
      },
    ],
    // No Manager+ connection: excluded, because the agent starts from the network.
    connections: [],
  },
];
