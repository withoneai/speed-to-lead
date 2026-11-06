import { DEMO, DEMO_REASON, SLA_MINUTES, WATCH_SECONDS, runDate, slackConfigured } from "./config.js";
import { readLeadCompanies, readNewLeads, readOwners } from "./hubspot.js";
import { describeWait, leadName, triage } from "./triage.js";
import { assess } from "./assess.js";
import { createDraft } from "./draft.js";
import { formatDigest, postDigest } from "./slack.js";
import { loadDrafted, saveDrafted } from "./state.js";
import type { Handled, Route } from "./types.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    [
      "Usage:",
      "  npm start                    read new HubSpot leads, draft the first reply to each one nobody has answered",
      "  npm start -- --watch         keep polling (every WATCH_SECONDS, default 120)",
      "  npm start -- --dry-run       print every reply, create nothing in Gmail, post nothing",
      "  npm start -- --demo          replay a recorded morning, no keys, no network",
      "",
      `A lead counts as late after ${SLA_MINUTES} minutes (SLA_MINUTES).`,
    ].join("\n"),
  );
  process.exit(0);
}
const dryRun = args.includes("--dry-run");
const watch = args.includes("--watch") && !DEMO;

const SKIP_NOTE: Record<Exclude<Route, "reply" | "existing_account">, string> = {
  already_answered: "skipped, someone on the team already logged a touch",
  no_email: "skipped, no email on the contact",
};

async function runOnce(): Promise<void> {
  const now = runDate();
  const drafted = DEMO ? new Set<string>() : loadDrafted();

  const leads = (await readNewLeads(now)).filter((l) => !drafted.has(l.id));
  const [companies, owners] = await Promise.all([readLeadCompanies(leads.map((l) => l.id)), readOwners()]);
  const triaged = leads.map((l) => triage(l, companies.get(l.id) ?? null, owners, now));
  console.log(`${leads.length} new lead${leads.length === 1 ? "" : "s"} to look at\n`);

  const handled: Handled[] = [];
  for (const t of triaged.sort((a, b) => b.minutesWaiting - a.minutesWaiting)) {
    const name = leadName(t.lead);
    const where = t.company?.name || t.lead.companyName || "no company";
    const clock = `waiting ${describeWait(t.minutesWaiting)}${t.late ? ", LATE" : ""}`;

    if (t.route === "already_answered" || t.route === "no_email") {
      console.log(`── ${name} (${where})  ${SKIP_NOTE[t.route]}`);
      continue;
    }
    if (t.route === "existing_account") {
      const owner = t.accountOwner ? `${t.accountOwner.firstName} ${t.accountOwner.lastName}`.trim() : "nobody (no owner on the company)";
      const why = t.company?.lifecycleStage === "customer" ? "already a customer" : `${t.company?.openDeals} open deal`;
      console.log(`── ${name} (${where})  ${clock}`);
      console.log(`   existing account: ${why}. Routed to ${owner}, no cold reply drafted.`);
      handled.push({ triage: t, assessment: null, draftId: "" });
      continue;
    }

    console.log(`── ${name}, ${t.lead.jobTitle || "no title"} (${where})  ${clock}`);
    try {
      const a = await assess(t);
      console.log(`   ${a.fit} fit -> ${a.reply.replaceAll("_", " ")}${a.downgraded ? "  (downgraded: no ICP quote checked out)" : ""}`);
      console.log(`   ${a.reason}`);
      for (const q of a.evidence) console.log(`   icp: "${q}"`);

      let draftId = "";
      if (DEMO || dryRun) {
        console.log(`   subject: ${a.subject}`);
        console.log(`   ${a.body.split("\n").join("\n   ")}`);
      } else {
        draftId = await createDraft(t.lead.email, a.subject, a.body);
        drafted.add(t.lead.id);
        saveDrafted(drafted);
        console.log(`   gmail draft created (${draftId})`);
      }
      handled.push({ triage: t, assessment: a, draftId });
    } catch (err) {
      console.error(`   failed: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
    console.log("");
  }

  const replies = handled.filter((h) => h.assessment);
  const late = replies.filter((h) => h.triage.late).length;
  const accounts = handled.length - replies.length;
  console.log(
    `\n${replies.length} repl${replies.length === 1 ? "y" : "ies"} drafted (${late} past the ${SLA_MINUTES} min target), ${accounts} routed to an account owner.`,
  );

  const digest = formatDigest(handled, SLA_MINUTES);
  if (digest && slackConfigured() && !DEMO && !dryRun) {
    await postDigest(digest);
    console.log("slack digest posted");
  } else if (digest && (DEMO || dryRun)) {
    console.log(`\nslack digest (not posted):\n${digest}`);
  }

  if (dryRun) console.log("\ndry run: nothing created in Gmail, nothing posted");
  else if (DEMO) console.log("\ndemo mode: nothing was created in Gmail, nothing was sent anywhere");
}

const demoNote = DEMO ? ` (demo: ${DEMO_REASON}, replaying a recorded morning)` : "";
console.log(`── speed to lead${demoNote}\n`);
if (DEMO && DEMO_REASON !== "--demo") {
  console.log("   No keys found, so this replays one recorded morning of inbound leads for a fictional");
  console.log("   spend-analytics company: real pipeline, fictional leads.\n");
}

await runOnce();
while (watch) {
  await new Promise((r) => setTimeout(r, WATCH_SECONDS * 1000));
  console.log(`\n── poll ${new Date().toISOString()}\n`);
  await runOnce().catch((err) => {
    console.error(`poll failed: ${err instanceof Error ? err.message : err}`);
  });
}
