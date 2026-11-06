import {
  batchReadAssociationsBetweenObjectTypes,
  batchReadCrmObjectsIdOrUniqueProperty,
  listCrmOwnersPaginated,
  searchCrmObjectsObjectType,
} from "@withone/sdk/hubspot";
import { DEMO, LOOKBACK_HOURS, connections, loadFixture, oneClient } from "./config.js";
import type { Company, Lead, Owner } from "./types.js";

/**
 * Every call here is a typed action from the One SDK's HubSpot module. All of
 * them are reads: this agent never writes to the CRM. Logging the reply is
 * the rep's job when they hit send, which is also how HubSpot sets the
 * "last contacted" date the next run reads.
 */

const CONTACT_PROPERTIES = [
  "email",
  "firstname",
  "lastname",
  "jobtitle",
  "company",
  "message",
  "hs_analytics_source",
  "createdate",
  "notes_last_contacted",
  "hubspot_owner_id",
];

const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "industry",
  "numberofemployees",
  "lifecyclestage",
  "hs_num_open_deals",
  "hubspot_owner_id",
];

interface CrmObject {
  id: string;
  properties: Record<string, string | null | undefined>;
}

function crm() {
  return oneClient().connection(connections.hubspot());
}

function results<T>(data: unknown): T[] {
  const list = (data as { results?: unknown })?.results;
  return Array.isArray(list) ? (list as T[]) : [];
}

const str = (v: string | null | undefined) => (v ?? "").trim();
const date = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(/^\d+$/.test(v) ? Number(v) : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function toLead(c: CrmObject): Lead {
  const p = c.properties;
  return {
    id: c.id,
    email: str(p.email).toLowerCase(),
    firstName: str(p.firstname),
    lastName: str(p.lastname),
    jobTitle: str(p.jobtitle),
    companyName: str(p.company),
    message: str(p.message),
    source: str(p.hs_analytics_source),
    createdAt: date(p.createdate) ?? new Date(0),
    lastContactedAt: date(p.notes_last_contacted),
    ownerId: str(p.hubspot_owner_id),
  };
}

export function toCompany(c: CrmObject): Company {
  const p = c.properties;
  const employees = Number(p.numberofemployees);
  return {
    id: c.id,
    name: str(p.name),
    domain: str(p.domain).toLowerCase(),
    industry: str(p.industry),
    employees: p.numberofemployees && Number.isFinite(employees) ? employees : null,
    lifecycleStage: str(p.lifecyclestage),
    openDeals: Number(p.hs_num_open_deals) || 0,
    ownerId: str(p.hubspot_owner_id),
  };
}

/** Contacts created inside the lookback window, newest first. */
export async function readNewLeads(now: Date): Promise<Lead[]> {
  if (DEMO) return (loadFixture("hubspot/contacts.json") as { results: CrmObject[] }).results.map(toLead);

  const since = now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000;
  const leads: Lead[] = [];
  let after = "0";
  for (;;) {
    const res = await crm().run(
      searchCrmObjectsObjectType({
        path: { objectType: "contacts" },
        body: {
          filterGroups: [{ filters: [{ propertyName: "createdate", operator: "GTE", value: String(since) }] }],
          properties: CONTACT_PROPERTIES,
          sorts: ["createdate"],
          limit: 100,
          after,
        },
      }),
    );
    leads.push(...results<CrmObject>(res.data).map(toLead));
    const next = (res.data as { paging?: { next?: { after?: string } } })?.paging?.next?.after;
    if (!next) break;
    after = next;
  }
  return leads;
}

/**
 * Contact id -> the company HubSpot associated it with (usually by email
 * domain, automatically). Two calls: one association read, one batch read.
 * HubSpot has returned the target id as `toObjectId` and as `id` at
 * different times, so both are read.
 */
export async function readLeadCompanies(leadIds: string[]): Promise<Map<string, Company>> {
  const byLead = new Map<string, Company>();
  if (!leadIds.length) return byLead;

  if (DEMO) {
    const fx = loadFixture("hubspot/companies.json") as { associations: Record<string, string>; results: CrmObject[] };
    const companies = new Map(fx.results.map((c) => [c.id, toCompany(c)]));
    for (const id of leadIds) {
      const company = companies.get(fx.associations[id]);
      if (company) byLead.set(id, company);
    }
    return byLead;
  }

  const assoc = await crm().run(
    batchReadAssociationsBetweenObjectTypes({
      path: { fromObjectType: "contacts", toObjectType: "companies" },
      body: { inputs: leadIds.map((id) => ({ id })) },
    }),
  );
  const leadCompany = new Map<string, string>();
  for (const row of results<{ from?: { id?: string }; to?: Array<{ toObjectId?: string | number; id?: string | number }> }>(
    assoc.data,
  )) {
    const to = row.to?.[0]?.toObjectId ?? row.to?.[0]?.id;
    if (row.from?.id && to !== undefined) leadCompany.set(row.from.id, String(to));
  }
  const ids = [...new Set(leadCompany.values())];
  if (!ids.length) return byLead;

  const res = await crm().run(
    batchReadCrmObjectsIdOrUniqueProperty({
      path: { objectType: "companies" },
      body: { properties: COMPANY_PROPERTIES, propertiesWithHistory: [], inputs: ids.map((id) => ({ id })) },
    }),
  );
  const companies = new Map(results<CrmObject>(res.data).map((c) => [c.id, toCompany(c)]));
  for (const [leadId, companyId] of leadCompany) {
    const company = companies.get(companyId);
    if (company) byLead.set(leadId, company);
  }
  return byLead;
}

/** Owner id -> owner, so an existing account goes to a person, not a number. */
export async function readOwners(): Promise<Map<string, Owner>> {
  const raw = DEMO
    ? (loadFixture("hubspot/owners.json") as { results: Array<Record<string, string>> }).results
    : results<Record<string, string>>((await crm().run(listCrmOwnersPaginated({ query: { limit: 100 } }))).data);
  const byId = new Map<string, Owner>();
  for (const o of raw) {
    byId.set(String(o.id), { id: String(o.id), email: o.email ?? "", firstName: o.firstName ?? "", lastName: o.lastName ?? "" });
  }
  return byId;
}

/** A cheap liveness probe for `npm run check`: one owners page. */
export async function probeHubSpot(): Promise<number> {
  const res = await crm().run(listCrmOwnersPaginated({ query: { limit: 10 } }));
  return results(res.data).length;
}
