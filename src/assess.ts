import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CLAUDE_MODEL, DEMO, loadFixture, loadIcp } from "./config.js";
import { describeWait } from "./triage.js";
import type { Assessment, Triage } from "./types.js";

const AssessmentSchema = z.object({
  fit: z.enum(["strong", "possible", "poor"]),
  reply: z.enum(["book_call", "answer_first", "point_to_guide"]),
  reason: z.string(),
  evidence: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
});
type RawAssessment = z.infer<typeof AssessmentSchema>;

/** The exact prompt sent for one lead. Exported so the demo recording can be reproduced. */
export function buildPrompt(t: Triage, icp: string): string {
  const { lead, company } = t;
  const companyBlock = company
    ? [
        `Name: ${company.name || "(none)"}`,
        `Domain: ${company.domain || "(none)"}`,
        `Industry: ${company.industry || "(not set)"}`,
        `Employees: ${company.employees ?? "(not set)"}`,
        `Lifecycle stage in our CRM: ${company.lifecycleStage || "(not set)"}`,
      ].join("\n")
    : "HubSpot has no company record associated with this contact.";

  return `You are the first responder for inbound leads. Read the lead against our ICP and reply rules below, decide how well it fits, and write the first reply. A person reviews the draft before it is sent.

## Our ICP and reply rules (config/icp.md)

${icp}

## The lead

Name: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "(no name)"}
Email: ${lead.email}${t.personalEmail ? " (a personal email address)" : ""}
Job title: ${lead.jobTitle || "(not given)"}
Company they typed: ${lead.companyName || "(not given)"}
Source: ${lead.source || "(unknown)"}
Waiting: ${describeWait(t.minutesWaiting)} since they submitted
Their message: ${lead.message ? `"${lead.message}"` : "(no message)"}

## What our CRM already knows about the company

${companyBlock}

## Instructions

- fit: strong, possible or poor, judged only against the ICP above.
- reply: book_call for a strong fit, answer_first when they asked a real question, point_to_guide for a poor fit. Follow the reply rules exactly.
- reason: one sentence for the sales channel, naming the concrete facts that decided it.
- evidence: one to three lines copied word for word from the ICP file that support the fit. Copy them exactly; they are checked.
- subject and body: the reply email. Address them by first name if you have it. Answer their message if they asked something, using only facts in the ICP file. Use only links that appear in the ICP file. Never invent a number, a feature, an integration, or a fact about them.
- Do not mention how long they waited.
- Style: no em dashes or en dashes anywhere. Use a comma, period, colon, or parentheses instead.`;
}

const norm = (s: string) =>
  s
    .replace(/^[\s>*-]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * The model's answer is checked in code before anything is drafted:
 * - every evidence quote must exist in config/icp.md, or it is dropped;
 * - a "strong" fit with no surviving quote is downgraded to "possible";
 * - a poor fit never gets a call offered, whatever the model wrote;
 * - any link in the body that is not in config/icp.md is removed;
 * - dashes the style rule bans are replaced.
 */
export function verify(raw: RawAssessment, icp: string): Assessment {
  const haystack = norm(icp);
  const evidence = raw.evidence
    .filter((q) => norm(q).length > 8 && haystack.includes(norm(q)))
    .map((q) => q.replace(/^[\s>*-]+/, "").trim());

  let fit = raw.fit;
  let downgraded = false;
  if (fit === "strong" && evidence.length === 0) {
    fit = "possible";
    downgraded = true;
  }

  let reply = raw.reply;
  if (fit === "poor") reply = "point_to_guide";
  if (fit !== "strong" && reply === "book_call") reply = "answer_first";

  const allowed = new Set(icp.match(/https?:\/\/[^\s)]+/g) ?? []);
  const body = raw.body
    .replace(/https?:\/\/[^\s)]+/g, (url) => {
      const clean = url.replace(/[.,;:]+$/, "");
      return allowed.has(clean) ? url : "[link removed: not in config/icp.md]";
    })
    .replace(/\s*[—–]\s*/g, ", ");

  return {
    fit,
    reply,
    reason: raw.reason,
    evidence,
    subject: raw.subject.replace(/\s*[—–]\s*/g, ", "),
    body,
    downgraded,
  };
}

let client: Anthropic | undefined;

/** One Claude call per lead routed "reply". */
export async function assess(t: Triage): Promise<Assessment> {
  const icp = loadIcp();
  if (DEMO) {
    const recorded = loadFixture("assessments.json") as Record<string, RawAssessment>;
    const raw = recorded[t.lead.id];
    if (!raw) throw new Error(`No recorded assessment for contact ${t.lead.id} in fixtures/assessments.json.`);
    return verify(AssessmentSchema.parse(raw), icp);
  }

  client ??= new Anthropic();
  const response = await client.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: buildPrompt(t, icp) }],
    output_config: { format: zodOutputFormat(AssessmentSchema) },
  });
  if (response.stop_reason === "refusal") throw new Error(`Claude declined to assess contact ${t.lead.id}.`);
  if (!response.parsed_output) throw new Error("Claude returned output that did not match the schema.");
  return verify(response.parsed_output, icp);
}
