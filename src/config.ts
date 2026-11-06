import "dotenv/config";
import { readFileSync } from "node:fs";
import { One } from "@withone/sdk";

/**
 * Demo mode replays a recorded morning of HubSpot leads and the Claude calls
 * made on them, from fixtures/. It turns on two ways: explicitly with --demo,
 * or implicitly when the keys are absent. The implicit fallback is what makes
 * a fresh clone runnable with zero configuration: the same pipeline runs end
 * to end, only the HubSpot reads and the Claude call come off disk.
 */
const KEYS_PRESENT = Boolean(
  process.env.ONE_SECRET &&
    process.env.ANTHROPIC_API_KEY &&
    process.env.ONE_CONNECTION_HUBSPOT &&
    process.env.ONE_CONNECTION_GMAIL,
);

export const DEMO = process.argv.includes("--demo") || !KEYS_PRESENT;
export const DEMO_REASON = process.argv.includes("--demo")
  ? "--demo"
  : KEYS_PRESENT
    ? ""
    : "no keys in the environment";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    console.error("Or run `npm start -- --demo` to replay a recorded morning, no keys needed.");
    process.exit(1);
  }
  return value;
}

let client: One | undefined;
export function oneClient(): One {
  client ??= new One(required("ONE_SECRET"));
  return client;
}

export const connections = {
  hubspot: () => required("ONE_CONNECTION_HUBSPOT"),
  gmail: () => required("ONE_CONNECTION_GMAIL"),
  slack: () => required("ONE_CONNECTION_SLACK"),
};

/** Slack is an optional output: configured means both halves set. */
export const slackConfigured = () => Boolean(process.env.ONE_CONNECTION_SLACK && process.env.SLACK_CHANNEL);
export const slackChannel = () => required("SLACK_CHANNEL");

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} must be a positive number, not "${raw}".`);
    process.exit(1);
  }
  return value;
}

/**
 * The clock lives in code, not in config/icp.md. How many minutes counts as
 * late is a number. Whether this particular lead is worth a call is not.
 */
export const LOOKBACK_HOURS = numberEnv("LOOKBACK_HOURS", 24);
export const SLA_MINUTES = numberEnv("SLA_MINUTES", 15);
export const WATCH_SECONDS = numberEnv("WATCH_SECONDS", 120);

export function loadFixture(relPath: string): unknown {
  const url = new URL(`../fixtures/${relPath}`, import.meta.url);
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    throw new Error(`No fixture at fixtures/${relPath}.`);
  }
}

/**
 * "Now" for the run. Live, it is the clock. In demo mode it is pinned to the
 * moment the fixtures were captured, so "4 minutes waiting" means the same
 * thing no matter when you clone the repo.
 */
export function runDate(): Date {
  if (DEMO) {
    const meta = loadFixture("meta.json") as { captured_at: string };
    return new Date(meta.captured_at);
  }
  return new Date();
}

export function loadIcp(): string {
  return readFileSync(new URL("../config/icp.md", import.meta.url), "utf8");
}
