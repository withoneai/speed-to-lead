/** A new lead, read from a HubSpot contact. */
export interface Lead {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyName: string;
  /** What they wrote in the form, if the form has a message field. */
  message: string;
  source: string;
  createdAt: Date;
  /** Set by HubSpot when anyone on the team logged a sales email, call or meeting. */
  lastContactedAt: Date | null;
  ownerId: string;
}

/** The company HubSpot already associates with the lead, if any. */
export interface Company {
  id: string;
  name: string;
  domain: string;
  industry: string;
  employees: number | null;
  lifecycleStage: string;
  openDeals: number;
  ownerId: string;
}

export interface Owner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * What code established about one lead before any model sees it. None of
 * this is judgment: it is the clock, and what the CRM already says.
 */
export type Route =
  /** Nobody has replied and nobody owns the relationship: the agent drafts the first reply. */
  | "reply"
  /** Someone on the team already logged a touch. Leave it alone. */
  | "already_answered"
  /** The company is a customer or has an open deal: the account owner answers, not a cold reply. */
  | "existing_account"
  /** No email on the contact: there is nobody to reply to. */
  | "no_email";

export interface Triage {
  lead: Lead;
  company: Company | null;
  route: Route;
  minutesWaiting: number;
  late: boolean;
  personalEmail: boolean;
  /** For existing_account: who should take it. */
  accountOwner: Owner | null;
}

export type Fit = "strong" | "possible" | "poor";
export type Reply = "book_call" | "answer_first" | "point_to_guide";

/** The model's call on one lead, after the code has checked its quotes. */
export interface Assessment {
  fit: Fit;
  reply: Reply;
  /** One line for the console and the Slack digest. */
  reason: string;
  /** Lines quoted from config/icp.md. Only quotes that exist in the file survive. */
  evidence: string[];
  subject: string;
  body: string;
  /** True when the code downgraded the model's fit because its quotes did not check out. */
  downgraded: boolean;
}

export interface Handled {
  triage: Triage;
  assessment: Assessment | null;
  draftId: string;
}
