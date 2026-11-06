# speed-to-lead

Every new HubSpot lead, read against an ICP you wrote in plain English and against what HubSpot already knows about the company, and answered with the right first reply as a **Gmail draft** within minutes. The clock is on every one. Nothing is sent.

Built on [One](https://withone.ai): HubSpot, Gmail and Slack calls go through the One SDK, and Claude makes the call on each lead.

## Run it in 60 seconds, no keys

```bash
git clone https://github.com/withoneai/speed-to-lead
cd speed-to-lead
npm install
npm start
```

With no keys in the environment, the same pipeline runs against a recorded morning of eight inbound leads for Harborline, a fictional spend-analytics company. The Claude answers in `fixtures/assessments.json` are five real calls on the exact prompt the code builds (`npx tsx scripts/print-prompts.ts --demo` prints them). The run exits 0 and creates nothing anywhere.

## What it does

1. **Reads every contact created in HubSpot in the last 24 hours** (`LOOKBACK_HOURS`), with the company HubSpot associated it with.
2. **Starts the clock in code.** Minutes since the form was submitted, and a late flag past `SLA_MINUTES` (default 15).
3. **Leaves alone what is not a cold lead.** If someone on the team already logged a touch after the lead arrived, it is skipped. If the company is already a customer or has an open deal, it goes to that company's owner by name and no cold reply is drafted.
4. **Has Claude read the rest against `config/icp.md`**: strong, possible or poor fit, which reply (offer a call, answer the question first, or point to the guide), one line of reasoning, and the ICP lines it relied on, quoted.
5. **Checks the model in code before drafting anything.** A quote that is not in the ICP file is dropped. A strong fit with no surviving quote is downgraded and loses the call offer. A poor fit never gets a call offered. A link that is not in the ICP file is removed from the body.
6. **Creates one Gmail draft per lead** and, if Slack is configured, posts one digest to a channel with the longest-waiting lead first.

## Go live in about 5 minutes

```bash
npm i -g @withone/cli
one init
one add hubspot
one add gmail
one add slack           # optional
cp .env.example .env    # ONE_SECRET, ANTHROPIC_API_KEY, the connection keys
npm run check           # the ICP file parses, every connection answers
npm start -- --dry-run  # print every reply, create nothing
npm start               # draft for real
npm start -- --watch    # keep polling every 2 minutes
```

Edit `config/icp.md` first. It is the only file the model reads about your business, and the replies may only use the links and facts written in it.

Live runs remember which contacts they drafted for in `.state/drafted.json`, so a second run or the next `--watch` poll does not stack a second draft.

## What it does not do

- **It does not send.** A person reads every draft and hits send. When they do, logging the email in HubSpot is what tells the next run the lead was answered.
- **It is not instant.** It polls. Two minutes is the default in `--watch` mode. A HubSpot workflow webhook would get you seconds, and is not included.
- **It does not research outside your CRM.** It knows what the form and HubSpot know. For web research on the company, see [gtm-lead-agent](https://github.com/withoneai/gtm-lead-agent).
- **The quote check is not a fact check.** In the recorded run, Claude told a reseller "We don't offer reseller arrangements or partner margins." The ICP file never says that. Every quote checked out, the link was allowed, and the sentence still went into the draft. Read before sending.
- **It does not write to HubSpot.** No lead status, no owner assignment, no tasks.

## Cost

One Claude call per lead that needs a reply. The five recorded calls came to $0.19 together on `claude-opus-5-5`, about 4 cents a lead. HubSpot calls per run: one search page per 100 new contacts, one association read, one company batch read, one owners page.

## License

MIT
