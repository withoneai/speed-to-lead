import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verify } from "../src/assess.js";
import { triage, isPersonalEmail } from "../src/triage.js";
import type { Company, Lead } from "../src/types.js";

const icp = readFileSync(new URL("../config/icp.md", import.meta.url), "utf8");
const base = { fit: "strong" as const, reply: "book_call" as const, reason: "r", subject: "s", body: "b" };

test("quotes that are not in the ICP file are dropped", () => {
  const a = verify({ ...base, evidence: ["Companies with 50 to 2,000 employees.", "Enterprise buyers with 10,000 seats."] }, icp);
  assert.deepEqual(a.evidence, ["Companies with 50 to 2,000 employees."]);
  assert.equal(a.fit, "strong");
});

test("a strong fit with no surviving quote is downgraded and loses the call offer", () => {
  const a = verify({ ...base, evidence: ["Anyone who asks nicely."] }, icp);
  assert.equal(a.fit, "possible");
  assert.equal(a.reply, "answer_first");
  assert.equal(a.downgraded, true);
});

test("a poor fit never gets a call offered", () => {
  const a = verify({ ...base, fit: "poor", evidence: ["Companies under 20 employees."] }, icp);
  assert.equal(a.reply, "point_to_guide");
});

test("links not in the ICP file are removed, and banned dashes are replaced", () => {
  const a = verify({ ...base, evidence: [], body: "Book here https://evil.example.com/x — or https://cal.example.com/harborline/intro." }, icp);
  assert.ok(!a.body.includes("evil.example.com"));
  assert.ok(a.body.includes("https://cal.example.com/harborline/intro"));
  assert.ok(!/[—–]/.test(a.body));
});

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "1", email: "a@acme.com", firstName: "A", lastName: "B", jobTitle: "CFO", companyName: "Acme", message: "", source: "",
  createdAt: new Date("2026-11-05T15:00:00Z"), lastContactedAt: null, ownerId: "", ...over,
});
const company = (over: Partial<Company> = {}): Company => ({
  id: "9", name: "Acme", domain: "acme.com", industry: "", employees: 100, lifecycleStage: "lead", openDeals: 0, ownerId: "", ...over,
});
const now = new Date("2026-11-05T15:20:00Z");

test("the clock and the late flag come from code", () => {
  const t = triage(lead(), company(), new Map(), now);
  assert.equal(t.minutesWaiting, 20);
  assert.equal(t.late, true);
  assert.equal(t.route, "reply");
});

test("a logged touch after the lead arrived means someone already answered", () => {
  const t = triage(lead({ lastContactedAt: new Date("2026-11-05T15:10:00Z") }), company(), new Map(), now);
  assert.equal(t.route, "already_answered");
});

test("customers and companies with an open deal go to their owner, not a cold reply", () => {
  const owners = new Map([["7", { id: "7", email: "o@x.com", firstName: "Dana", lastName: "W" }]]);
  assert.equal(triage(lead(), company({ lifecycleStage: "customer", ownerId: "7" }), owners, now).accountOwner?.firstName, "Dana");
  assert.equal(triage(lead(), company({ openDeals: 2 }), owners, now).route, "existing_account");
});

test("personal email domains are recognised", () => {
  assert.equal(isPersonalEmail("x@gmail.com"), true);
  assert.equal(isPersonalEmail("x@acme.com"), false);
});
