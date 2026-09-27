# Marketing

## Status

Draft.

This document proposes the go-to-market contract for Treq. It defines the audiences, what marketing may claim, the acquisition channels, and the gates between phases. The owner approves each remaining item in [Open decisions](#open-decisions) before the plan is Active.

Approval of this strategy does not authorize spending money, sending outreach, or creating external accounts. Each of those needs its own approval.

The plan skips a user-validation phase. There is no interview program or positioning test before execution. Live acquisition and conversion data corrects the plan instead, reviewed weekly through the GTM digest.

The automation that runs this plan lives in [Ziinc/biz-tools](https://github.com/Ziinc/biz-tools). The `gtm` and `content` blocks for `treq` in its `config.yaml` must match this document.

## Approved decisions

Approved by the owner on 2026-09-27:

1. No cash budget. Marketing is organic only.
2. Four marketing hours per week.
3. Treq supports macOS, Windows, and Linux. Every page states all three platforms.
4. Collect emails for the private alpha, with explicit consent.

## Summary

Treq is the open-source Stacking Agent Development Environment. Each coding agent gets its own workspace, branches stack, and Treq rebases dependent work when the base moves. The desktop app is free. Pro is a cloud subscription at US$15 per user per month that adds GitHub integration for private repositories.

Marketing has one job: bring engineers who run several coding agents on one repository to the download, and move teams that need private repositories onto Pro. Organic search carries acquisition. Roadmap milestones supply the launch moments. A private alpha list collects the engineers who want early access. There is no cash budget, so every channel runs on founder time.

## Product truth

Marketing copy may only claim what the product does today. Check claims against this section and against the code before publishing.

### Shipped

- Workspaces for parallel work, each with its own branch, files, terminal, and review.
- Stacked workspaces with automatic rebase when the base moves, built on Jujutsu over a colocated Git repository. Users do not need to install or learn `jj`.
- Agent sessions for Claude, Codex, and Cursor.
- Review, commit, push, and local merge from the app.
- Linear integration: view issues, create workspaces from issues, and auto-kickoff on a label. A personal API key is free. OAuth is Pro.
- GitHub integration: create and view pull requests, CI status, and inline review threads.
- Desktop builds for macOS on Apple silicon and Intel, Windows, and Linux, distributed through GitHub Releases. The current version is 0.3.0.
- The desktop app sends no feature usage, crash reports, or performance data. Diffs, comments, and terminal metadata stay on the user's machine.

### Not shipped

- Workspace Checks.
- SSH Remote Development and Treq-managed VMs. See [Remote Development](./remote-development.md).
- Mobile apps. See [Mobile](./mobile.md).

### Site copy that conflicts with product truth

Fix these before any amplification. A visitor who finds a false claim stops trusting the rest of the page.

1. A pricing FAQ answer says GitHub integration is coming soon, but GitHub integration has partly shipped. Rewrite the answer to match the roadmap.
2. The comparison pages describe Treq as currently marketed for macOS. Treq supports macOS, Windows, and Linux. Update every comparison page to state all three platforms.

## Positioning

Proposed line: "Run many coding agents on one repository. Treq stacks their branches and rebases them for you."

Supporting claims, each backed by a demonstration on the site:

- Each agent works in isolation, so agents do not overwrite each other's files.
- Dependent work stacks, so you review small layers instead of one large diff.
- Rebases happen when the base moves, so a stack stays current without manual work.
- The app is open source and keeps code on your machine.

Treq competes with Conductor, Claude Squad, Emdash, Orca, Superset, and Graphite. The comparison pages under `/compare/` hold the current differences. Every competitor claim must match that competitor's current public documentation on the day it is published.

## Audiences

In priority order:

1. Engineers who run two or more coding agents on the same repository and lose time to conflicts, stale branches, or large diffs. This group feels the core problem and can adopt the free app alone.
2. Teams reviewing a high volume of AI-generated pull requests. This group has private repositories and a reason to buy Pro.
3. Users of stacked pull requests who want an open-source alternative to Graphite. This group already understands stacking and needs the fewest explanations.

These are hypotheses. The plan tests them with acquisition data, not interviews: the landing page and query mix that bring downloads and Pro subscriptions show which audience responds.

## Offer and conversion

| Plan | Price | Who it serves |
| --- | --- | --- |
| Free | US$0 | Open-source developers. Full desktop app and GitHub integration for public repositories. |
| Pro | US$15 per user per month | Teams with private repositories. GitHub integration for all repositories and Linear OAuth. |

The conversion path is: search or community post, then site page, then download from GitHub Releases, then account creation, then GitHub connection, then Pro subscription. The trigger to buy Pro is connecting a private repository.

Do not change prices, add discounts, or add plans through this document. Each of those needs a separate decision.

## Channels

| Priority | Channel | Assets | Automation |
| --- | --- | --- | --- |
| 1 | Organic search | Learn articles, comparison pages, free tools under `/tools/`, skills directory | biz-tools daily keyword report and weekly Draft content PRs |
| 2 | GitHub | README, release notes, changelog | Release notes follow `cliff.toml` |
| 3 | Private alpha list | Signup form on treq.dev, alpha invitations, alpha update emails | Signup counts reported in the GTM digest |
| 4 | Developer communities | One post per launch moment, written for that community's rules | None. The owner posts by hand. |
| 5 | Integration directories | Linear integration listing, GitHub App listing | None |

Organic search leads because it compounds and costs founder time, not cash. The free tools and the skills directory attract searchers who are not yet looking for Treq. Each of those pages must link to the relevant Learn article and to the download.

Community posts are limited to launch moments. A post without new product substance spends reputation that the next launch needs.

## Content engine

The biz-tools pipeline drafts content from Search Console data:

1. The daily report finds queries where treq.dev gets impressions but ranks poorly or has no page.
2. Every Monday, Draft content picks the top two queries not yet drafted. Informational queries become `/learn/how-to/` pages. Comparison queries become `/compare/` pages. Pricing and signup queries are not drafted automatically.
3. Claude writes the article prose in the Treq voice defined by `.claude/skills/explain-to-me/SKILL.md`, grounded in this repository.
4. biz-tools opens a draft pull request here with the pages and their manifest under `marketing/content/drafts/`.

The owner reviews each draft pull request before merge:

- Every product claim matches [Product truth](#product-truth).
- No claim appears in the avoid list in biz-tools `config.yaml`.
- The page is added to `web/sidebarsLearn.ts` or `web/sidebarsCompare.ts`.
- The site builds and every link resolves.

Close a draft that does not meet the bar. biz-tools records the query, so the pipeline does not draft it again.

## Launch moments

Each roadmap milestone gets one launch:

| Milestone | Roadmap target | Launch assets |
| --- | --- | --- |
| Workspace Checks | 2026 Q3 | Changelog entry, Learn article on quality gates for agent output, community post |
| SSH Remote Development | 2026 Q4 | Changelog entry, docs, Learn article, community post |

A launch waits for the feature to ship and for the site copy to match it. A roadmap date never overrides that rule. Private alpha members hear about each launch first.

## Private alpha list

The site collects email addresses from engineers who want early access to the private alpha. The list has one purpose: alpha invitations and alpha updates.

- The signup form states that purpose and asks for explicit consent. The consent record stores the date and the form version.
- Each email includes a one-click unsubscribe. An unsubscribe stops every later send.
- The list stays separate from account and billing email. Joining the list does not create an account.
- Store only the email address, the consent record, and the signup page. Do not add tracking pixels.
- The owner invites alpha members in batches and approves each send by hand.

## Phases and exit gates

The phases match `gtm.phases` for `treq` in biz-tools `config.yaml`. The weekly GTM digest reports gate status and suggests the next phase when every gate is met. The owner changes the phase by hand.

| Phase | Exit gates |
| --- | --- |
| Foundation: measurement and content engine | Search Console, Bing, and GA4 collection enabled in biz-tools. Stripe collection enabled for Pro revenue. The two site-copy conflicts fixed. Private alpha signup form live with consent and unsubscribe. Draft content producing reviewed pull requests weekly for 4 consecutive weeks. A baseline of weekly organic clicks and weekly download clicks recorded. |
| Acquisition: organic growth | Weekly organic clicks reach twice the foundation baseline. At least five Learn or comparison pages each bring 20 or more clicks per week. |
| Conversion: Free to Pro | The first 10 paying Pro seats. Monthly Pro churn measured for three months. |

The acquisition and conversion thresholds are working proposals, pending approval. Once the foundation baseline exists, the acquisition gates become metric gates in biz-tools config. Until then they stay manual.

## Measurement

The desktop app has no telemetry, and marketing must not add any. The funnel is measured at the site, at GitHub, and at the service.

| Step | Source | Metric |
| --- | --- | --- |
| Discover | Search Console, Bing Webmaster Tools | Clicks, impressions, and position by query and page |
| Visit | GA4 on treq.dev | Sessions and landing pages |
| Download intent | GA4 | Outbound clicks to GitHub Releases |
| Download | GitHub Releases API | Asset download counts per release |
| Join alpha | Alpha signup store | New consented signups and unsubscribes per week |
| Sign up | Supabase | New accounts per week |
| Connect | Supabase | Accounts with a GitHub connection |
| Buy | Stripe | New Pro seats, net revenue, refunds |
| Retain | Stripe | Monthly Pro churn |

Do not add fingerprinting or cross-site tracking. Report sample sizes with every rate. Never divide one source's count by another source's count and call the result a conversion rate unless both count the same people.

## Automation requirements

biz-tools already covers the keyword report, content drafting, the GTM digest, and Search Console, Bing, GA4, and Stripe collection. It still needs:

1. A GitHub Releases adapter that records asset download counts per release.
2. A Supabase adapter that reports weekly account creations and GitHub connections as aggregate counts. It must not export personal data.
3. A GA4 outbound-click event for the download link, so the digest can count download intent.
4. An adapter that reports weekly alpha signups and unsubscribes as aggregate counts.
5. Metric gates in biz-tools config for the acquisition phase, once the baseline exists.

## Non-goals

- A user interview or positioning-test program before execution.
- Telemetry in the desktop app.
- Any cash spend, including paid advertising and sponsorships.
- Referral rewards, affiliate programs, or a custom marketing CMS.
- Publishing drafted content without owner review.
- Marketing features that are not shipped.

## Open decisions

| ID | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| T06 | Acquisition and conversion thresholds | The working proposals in [Phases and exit gates](#phases-and-exit-gates), or other numbers. | Approve the proposals and revisit them at the foundation exit. |
| T07 | Private alpha scope | Which features the private alpha covers, and the signup store. | Owner to define before the signup form ships. |

## Risks

| Risk | Signal | Response |
| --- | --- | --- |
| Content drafts contain wrong product claims | Review finds errors in more than one draft in a month | Tighten the avoid list and the product truth section. Lower the weekly draft count. |
| Traffic without downloads | Organic clicks grow while download clicks stay flat | Review landing pages for a clear next step. Check that the traffic matches the audiences. |
| Downloads without Pro conversion | Accounts grow but Pro seats do not | Check whether visitors have private repositories. Revisit which features Pro includes. |
| Competitor pages go stale | A competitor changes features or pricing | Re-check each comparison page once a quarter. |
| Marketing work crowds out product work | Marketing time exceeds four hours per week for three weeks | Cut community posts first, then draft volume. |
