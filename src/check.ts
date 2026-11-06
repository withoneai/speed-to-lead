import { DEMO, loadIcp, slackConfigured } from "./config.js";
import { probeHubSpot } from "./hubspot.js";
import { probeGmail } from "./draft.js";

/** Proves the run will work: the ICP file parses, and (live only) every connection answers. */
let failed = false;
try {
  const icp = loadIcp();
  const links = icp.match(/https?:\/\/[^\s)]+/g) ?? [];
  console.log(`✓ config/icp.md parses (${icp.split("\n").filter((l) => l.trim()).length} non-blank lines, ${links.length} links the replies may use)`);

  if (DEMO) {
    console.log("\nNo keys in the environment, so no connection was probed.");
    console.log("This clone will run `npm start` in demo mode: a recorded morning, real pipeline.");
  } else {
    const owners = await probeHubSpot();
    console.log(`✓ HubSpot answers (${owners} owner${owners === 1 ? "" : "s"} on the first page)`);
    console.log(`✓ Gmail answers (${await probeGmail()})`);
    console.log(slackConfigured() ? "· Slack configured, probed on the first real post" : "· Slack not configured, digest prints to the console");
  }
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
