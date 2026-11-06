/**
 * Prints the exact prompt the agent sends for each demo lead routed "reply".
 * Used to record fixtures/assessments.json from real Claude calls:
 *   npx tsx scripts/print-prompts.ts --demo > prompts.json
 */
import { loadIcp, runDate } from "../src/config.js";
import { readLeadCompanies, readNewLeads, readOwners } from "../src/hubspot.js";
import { triage } from "../src/triage.js";
import { buildPrompt } from "../src/assess.js";

const now = runDate();
const leads = await readNewLeads(now);
const [companies, owners] = await Promise.all([readLeadCompanies(leads.map((l) => l.id)), readOwners()]);
const icp = loadIcp();
const out: Record<string, string> = {};
for (const l of leads) {
  const t = triage(l, companies.get(l.id) ?? null, owners, now);
  if (t.route === "reply") out[l.id] = buildPrompt(t, icp);
}
console.log(JSON.stringify(out, null, 2));
