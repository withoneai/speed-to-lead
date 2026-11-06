import * as slack from "@withone/sdk/slack";
import { connections, oneClient, slackChannel } from "./config.js";
import { describeWait, leadName } from "./triage.js";
import type { Handled } from "./types.js";

const SLACK_LIMIT = 3800;

/** One message for the run: who is waiting, for how long, and what is drafted. */
export function formatDigest(handled: Handled[], slaMinutes: number): string {
  const lines: string[] = [];
  const drafted = handled.filter((h) => h.assessment);
  const accounts = handled.filter((h) => h.triage.route === "existing_account");
  if (!drafted.length && !accounts.length) return "";

  lines.push(`*Speed to lead:* ${drafted.length} repl${drafted.length === 1 ? "y" : "ies"} drafted, ${accounts.length} for an account owner`);
  for (const h of drafted.sort((a, b) => b.triage.minutesWaiting - a.triage.minutesWaiting)) {
    const t = h.triage;
    const a = h.assessment!;
    const clock = `${describeWait(t.minutesWaiting)}${t.late ? ` (past the ${slaMinutes} min target)` : ""}`;
    lines.push(`• *${leadName(t.lead)}*, ${t.lead.jobTitle || "no title"} at ${t.company?.name || t.lead.companyName || "unknown company"}: ${a.fit} fit, ${a.reply.replaceAll("_", " ")}, waiting ${clock}`);
    lines.push(`   ${a.reason}${a.downgraded ? " (fit downgraded: quotes did not check out, read before sending)" : ""}`);
  }
  for (const h of accounts) {
    const t = h.triage;
    const owner = t.accountOwner ? `${t.accountOwner.firstName} ${t.accountOwner.lastName}`.trim() : "no owner on the company";
    const why = t.company?.lifecycleStage === "customer" ? "already a customer" : `${t.company?.openDeals} open deal`;
    lines.push(`• *${leadName(t.lead)}* at ${t.company?.name}: ${why}, for ${owner}. No cold reply drafted.`);
  }
  lines.push("Drafts are in Gmail. Nothing was sent.");
  return lines.join("\n");
}

export async function postDigest(text: string): Promise<void> {
  const body = text.length > SLACK_LIMIT ? `${text.slice(0, SLACK_LIMIT - 1)}…` : text;
  const res = await oneClient()
    .connection(connections.slack())
    .run(slack.sendMessageChannelChatPostmessage({ body: { channel: slackChannel(), text: body } }));
  const data = res.data as { ok?: boolean; error?: string };
  if (data?.ok === false) throw new Error(`Slack rejected the message: ${data.error}`);
}
