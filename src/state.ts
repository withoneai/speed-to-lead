import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Contacts already drafted for, so a second run (or the next --watch poll)
 * does not stack a second draft on top of the first. Drafting does not touch
 * HubSpot, so HubSpot cannot tell us this. Live runs only.
 */
const DIR = new URL("../.state/", import.meta.url);
const FILE = new URL("drafted.json", DIR);

export function loadDrafted(): Set<string> {
  if (!existsSync(FILE)) return new Set();
  return new Set(JSON.parse(readFileSync(FILE, "utf8")) as string[]);
}

export function saveDrafted(ids: Set<string>): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify([...ids], null, 2));
}
