import { SLA_MINUTES } from "./config.js";
import type { Company, Lead, Owner, Triage } from "./types.js";

/**
 * Consumer mail domains. A lead on one of these has told you nothing about
 * their company, which the model is told as a fact rather than left to guess.
 */
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
]);

export function isPersonalEmail(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  return PERSONAL_DOMAINS.has(domain);
}

/**
 * Everything here is measurement, not judgment: how long the lead has
 * waited, whether someone already answered, and whether the company is
 * already somebody's account. The model only ever sees leads routed "reply".
 */
export function triage(lead: Lead, company: Company | null, owners: Map<string, Owner>, now: Date): Triage {
  const minutesWaiting = Math.max(0, Math.round((now.getTime() - lead.createdAt.getTime()) / 60000));
  const base = {
    lead,
    company,
    minutesWaiting,
    late: minutesWaiting > SLA_MINUTES,
    personalEmail: isPersonalEmail(lead.email),
    accountOwner: null as Owner | null,
  };

  if (!lead.email) return { ...base, route: "no_email" };
  if (lead.lastContactedAt && lead.lastContactedAt >= lead.createdAt) return { ...base, route: "already_answered" };

  const existing = company && (company.lifecycleStage === "customer" || company.openDeals > 0);
  if (existing) {
    const ownerId = company.ownerId || lead.ownerId;
    return { ...base, route: "existing_account", accountOwner: owners.get(ownerId) ?? null };
  }
  return { ...base, route: "reply" };
}

export function describeWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function leadName(lead: Lead): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email || `contact ${lead.id}`;
}
