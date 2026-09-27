# Marketing

## Status

Draft.

This document proposes the go-to-market contract for Treq. It defines the audiences, what marketing may claim, the acquisition channels, and the gates between phases. The owner approves each open decision in [Open decisions](#open-decisions) before the plan is Active.

Approval of this strategy does not authorize spending money, sending outreach, or creating external accounts. Each of those needs its own approval.

The plan skips a user-validation phase. There is no interview program or positioning test before execution. Live acquisition and conversion data corrects the plan instead, reviewed weekly through the GTM digest.

The automation that runs this plan lives in [Ziinc/biz-tools](https://github.com/Ziinc/biz-tools). The `gtm` and `content` blocks for `treq` in its `config.yaml` must match this document.

## Summary

Treq is the open-source Stacking Agent Development Environment. Each coding agent gets its own workspace, branches stack, and Treq rebases dependent work when the base moves. The desktop app is free. Pro is a cloud subscription at US$15 per user per month that adds GitHub integration for private repositories and the Treq-managed merge queue.

Marketing has one job: bring engineers who run several coding agents on one repository to the download, and move teams that need private repositories onto Pro. Organic search carries acquisition. Roadmap milestones supply the launch moments. Paid acquisition waits for conversion evidence.

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

- The Treq-managed merge queue. The roadmap lists it as work in progress.
- Workspace Checks.
- SSH Remote Development and Treq-managed VMs. See [Remote Development](./remote-development.md).
- Mobile apps. See [Mobile](./mobile.md).

### Site copy that conflicts with product truth

Fix these before any amplification. A visitor who finds a false claim stops trusting the rest of the page.

1. The pricing page sells merge queue as part of Pro, but the merge queue has not shipped. Label it as coming, or remove it from the Pro list until it ships.
2. A pricing FAQ answer says GitHub integration is coming soon, but GitHub integration has partly shipped. Rewrite the answer to match the roadmap.
3. The comparison pages describe Treq as currently marketed for macOS. The homepage and installation guide list Windows and Linux builds. Pick one platform statement and apply it to every page.

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
| Pro | US$15 per user per month | Teams with private repositories. GitHub integration for all repositories, Linear OAuth, and the merge queue when it ships. |

The conversion path is: search or community post, then site page, then download from GitHub Releases, then account creation, then GitHub connection, then Pro subscription. The trigger to buy Pro is connecting a private repository. The merge queue becomes a second trigger when it ships.

Do not change prices, add discounts, or add plans through this document. Each of those needs a separate decision.

## Channels

| Priority | Channel | Assets | Automation |
| --- | --- | --- | --- |
| 1 | Organic search | Learn articles, comparison pages, free tools under `/tools/`, skills directory | biz-tools daily keyword report and weekly Draft content PRs |
| 2 | GitHub | README, release notes, changelog | Release notes follow `cliff.toml` |
| 3 | Developer communities | One post per launch moment, written for that community's rules | None. The owner posts by hand. |
| 4 | Integration directories | Linear integration listing, GitHub App listing | None |

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
| Treq-managed merge queue | 2026 Q3 | Changelog entry, Learn article on stacked merge queues, comparison page update against GitHub's native merge queue, community post |
| Workspace Checks | 2026 Q3 | Changelog entry, Learn article on quality gates for agent output, community post |
| SSH Remote Development | 2026 Q4 | Changelog entry, docs, Learn article, community post |

A launch waits for the feature to ship and for the site copy to match it. A roadmap date never overrides that rule.

## Phases and exit gates

The phases match `gtm.phases` for `treq` in biz-tools `config.yaml`. The weekly GTM digest reports gate status and suggests the next phase when every gate is met. The owner changes the phase by hand.

| Phase | Exit gates |
| --- | --- |
| Foundation: measurement and content engine | Search Console, Bing, and GA4 collection enabled in biz-tools. Stripe collection enabled for Pro revenue. The three site-copy conflicts fixed. Draft content producing reviewed pull requests weekly for 4 consecutive weeks. A baseline of weekly organic clicks and weekly download clicks recorded. |
| Acquisition: organic growth | Weekly organic clicks reach twice the foundation baseline. At least five Learn or comparison pages each bring 20 or more clicks per week. |
| Conversion: Free to Pro | Merge queue shipped. The first 10 paying Pro seats. Monthly Pro churn measured for three months. |

The acquisition and conversion thresholds are working proposals, pending approval. Once the foundation baseline exists, the acquisition gates become metric gates in biz-tools config. Until then they stay manual.

## Measurement

The desktop app has no telemetry, and marketing must not add any. The funnel is measured at the site, at GitHub, and at the service.

| Step | Source | Metric |
| --- | --- | --- |
| Discover | Search Console, Bing Webmaster Tools | Clicks, impressions, and position by query and page |
| Visit | GA4 on treq.dev | Sessions and landing pages |
| Download intent | GA4 | Outbound clicks to GitHub Releases |
| Download | GitHub Releases API | Asset download counts per release |
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
4. Metric gates in biz-tools config for the acquisition phase, once the baseline exists.

## Non-goals

- A user interview or positioning-test program before execution.
- Telemetry in the desktop app.
- Paid advertising before the conversion phase shows paying Pro seats.
- Referral rewards, affiliate programs, or a custom marketing CMS.
- Publishing drafted content without owner review.
- Marketing features that are not shipped.

## Open decisions

| ID | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| T01 | Marketing cash budget | A: none, organic only. B: a small monthly ceiling for sponsorships. C: a paid-ads test budget. | A until the conversion phase starts. |
| T02 | Weekly founder hours for marketing | A: 2 hours. B: 4 hours. C: 8 hours. | B. Two hours for draft review, one for launches and communities, one for the digest and site fixes. |
| T03 | Platform statement | A: all three desktop platforms. B: macOS first, others available. | Whichever matches release quality today. Apply it to every page. |
| T04 | Merge queue on the pricing page | A: remove until shipped. B: keep, labeled as coming. | B, so the Pro value is clear without a false claim. |
| T05 | Email list | A: none. B: a release-notes list with explicit consent. | A until launch moments are frequent enough to fill a list. |
| T06 | Acquisition and conversion thresholds | The working proposals in [Phases and exit gates](#phases-and-exit-gates), or other numbers. | Approve the proposals and revisit them at the foundation exit. |

## Risks

| Risk | Signal | Response |
| --- | --- | --- |
| Content drafts contain wrong product claims | Review finds errors in more than one draft in a month | Tighten the avoid list and the product truth section. Lower the weekly draft count. |
| Traffic without downloads | Organic clicks grow while download clicks stay flat | Review landing pages for a clear next step. Check that the traffic matches the audiences. |
| Downloads without Pro conversion | Accounts grow but Pro seats do not | Check whether visitors have private repositories. Revisit Pro value after the merge queue ships. |
| Competitor pages go stale | A competitor changes features or pricing | Re-check each comparison page once a quarter. |
| Marketing work crowds out product work | Marketing time exceeds the approved hours for three weeks | Cut community posts first, then draft volume. |
