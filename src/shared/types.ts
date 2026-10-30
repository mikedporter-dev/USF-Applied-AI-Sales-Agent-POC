// Domain model shared by the browser app and the Worker.

/** S&P Composite 1500 = S&P 500 + MidCap 400 + SmallCap 600. */
export type IndexMembership = "S&P 500" | "S&P MidCap 400" | "S&P SmallCap 600";

export interface Company {
  /** SEC Central Index Key, zero-padded to 10 digits. Joins Massive and EDGAR data. */
  cik: string;
  ticker: string;
  name: string;
  /** GICS sector. */
  industry: string;
  index: IndexMembership;
  revenueUsd: number;
  employees: number;
}

export type SignalKind =
  | "ai_commitment" // concrete AI investment, program, or target stated in a filing
  | "ai_mention" // AI named as a priority or capability, with nothing concrete behind it
  | "leadership_change" // officer change (8-K Item 5.02, Form 3)
  | "acquisition" // 8-K Item 2.01
  | "restructuring" // 8-K Item 2.05 or reorg disclosed elsewhere
  | "ai_reorg" // restructuring explicitly tied to AI
  | "ai_pilot_no_results" // pilots or experiments with no reported outcome
  | "ai_scaled_results"; // large-scale AI results already published (demotes)

export type FilingForm = "10-K" | "10-Q" | "8-K" | "8-K EX-99" | "Form 3";

/** Massive is the primary source; EDGAR fills exhibits and MD&A. */
export type SignalSource = "massive" | "edgar";

export interface Signal {
  kind: SignalKind;
  summary: string;
  form: FilingForm;
  /** e.g. "Item 1A Risk Factors", "MD&A", "Item 5.02". */
  section?: string;
  /** ISO date (YYYY-MM-DD). */
  filedAt: string;
  source: SignalSource;
  url?: string;
  /** The filing text the signal rests on, when saved research recorded it. */
  quote?: string;
}

export type Seniority = "Manager" | "Director" | "VP" | "C-Suite" | "Owner/Partner";

/** A first-degree LinkedIn connection of the seller, matched to a company. */
export interface Connection {
  name: string;
  title: string;
  seniority: Seniority;
  connectedOn?: string;
}

export type EmailStatus = "not_enriched" | "enriched" | "unavailable";

/** Seller's decision on a target contact. Email enrichment requires "approved". */
export type ApprovalStatus = "pending" | "approved" | "rejected";

/** The one person per account the seller is trying to reach, found via Apollo. */
export interface TargetContact {
  /** target_contacts.id */
  id: number;
  name: string;
  title: string;
  /** Index into CONTACT_ROLE_LADDER that this contact matched. */
  ladderRank: number;
  approvalStatus: ApprovalStatus;
  /** ISO timestamp, set only while approved. */
  approvedAt?: string;
  emailStatus: EmailStatus;
  email?: string;
}

export interface AccountInput {
  company: Company;
  signals: Signal[];
  connections: Connection[];
  targetContact?: TargetContact;
  /** When saved research last ran for this company (ISO), if it has. */
  researchedAt?: string;
}

export type Tier = 1 | 2 | 3;

export interface Scores {
  fit: number;
  intent: number;
  gap: number;
  /** Weighted composite after any demotion. 0–100. */
  total: number;
}

export interface ScoredAccount extends AccountInput {
  rank: number;
  tier: Tier;
  scores: Scores;
  demoted: boolean;
  /** Human-readable reasons the account scored where it did. */
  whyRanks: string[];
  /** Most recent trigger event in the window, if any. */
  whyNow?: Signal;
  /** Most senior connection at the company. */
  warmPath?: Connection;
}

/** GET /api/accounts */
export interface AccountsResponse {
  source: "supabase" | "sample";
  /** ISO timestamp the 12-month window ends on. */
  asOf: string;
  accounts: ScoredAccount[];
}

/** GET /api/health */
export interface HealthResponse {
  ok: boolean;
  integrations: { nvidia: boolean; supabase: boolean; massive: boolean; edgar: boolean };
}

/** POST /api/contacts/approval */
export interface ApprovalRequest {
  contactIds: number[];
  status: ApprovalStatus;
}

export type ContactApprovalUpdate = Pick<TargetContact, "id" | "approvalStatus" | "approvedAt" | "emailStatus" | "email">;

export interface ApprovalResponse {
  contacts: ContactApprovalUpdate[];
}
