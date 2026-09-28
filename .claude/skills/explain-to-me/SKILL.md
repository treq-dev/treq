---
name: explain-to-me
description: >-
  The treq voice for explanatory prose: plain, declarative, for a peer
  engineer, with banlists for buzzwords and AI writing tells. Use when
  explaining a concept, writing code comments or explanatory docs, or whenever
  prose must teach a reader.
---

# Explain to me

## When to use

- The user asks to explain, clarify, or teach a concept.
- Writing or revising inline code comments that carry meaning.
- Drafting explanatory documentation (how something works, why a choice was made).
- Any prose whose job is to help a reader understand, not to sell or fill space.

For full site docs under `web/` (concept articles, READMEs, changelogs, release
notes), also use the matching structure skill. Product docs under `web/docs/`
and roadmap or security feature-status copy use `docs-writing`. Learn articles
under `web/learn/` use `writing`. Those skills own article structure, accuracy
rules, and interlinking. This skill owns the voice. Read this skill first
whenever voice, banlists, Orwell, or ASD-STE100 apply.

Read `web/STYLE_GUIDE.md` as the formatting baseline for published docs. Where
the two agree on formatting, the style guide wins. Where you need the voice
itself, use this.

## The voice, in one paragraph

You are explaining something to a peer senior engineer who is smart but new to
this specific topic. Second person. Confident and declarative. State the
mechanism before its implication, so the reader understands why before they are
told what it means. Use one earned metaphor where it makes an abstract idea
concrete, not for decoration. Sharpen a point with contrast when a distinction
matters. The writing is engaging because it is clear and has a point of view, not
because it is hyped. Trust the reader to keep up. The underlying discipline
comes from Orwell's rules and ASD-STE100. Cut every word that does not carry
weight. Make each sentence mean only one thing. The next section covers both,
plus where software terminology is exempt.

## Foundational principles: Orwell's rules and ASD-STE100

This voice is built on two sources: George Orwell's rules for clear prose, and
ASD-STE100 (Simplified Technical English), the standard aircraft-maintenance
writers use so a technical sentence cannot be misread. treq prose is lower
stakes than a maintenance manual, but the same discipline makes an explanation
easier to skim and harder to misread. Apply both to every draft.

### Orwell's six rules

From "Politics and the English Language" (1946).

1. Never use a metaphor, simile, or figure of speech you have seen in print
   before. If you cannot invent your own for the point you are making, cut it.
2. Never use a long word where a short one does the job. "Use" beats
   "utilize". "Start" beats "initiate".
3. If a word can come out, take it out. Every adjective and adverb has to earn
   its place in the sentence.
4. Never use the passive where you can use the active. "The service dispatches
   the alert", not "the alert is dispatched by the service".
5. Never use a foreign phrase, a scientific word, or jargon if an everyday
   English word says the same thing. This bends for software: a precise
   technical term is not jargon if it is the correct name for the thing. See
   "Where software terms fit" below.
6. Break any of these rules before you write something barbarous. Clarity
   wins over the rule.

### ASD-STE100 (Simplified Technical English)

Adapted here for explanatory prose, not the full aerospace dictionary standard.

- One idea, one sentence. If a sentence carries two instructions or two claims
  joined by "and", split it.
- Keep sentences short. 20 words is the target, 30 is the ceiling the
  readability checker flags. Longer sentences hide more than one claim.
- Give each concept one name and reuse it through the text. Do not vary between
  "repository", "repo", and "codebase" for the same referent. Pick the term the
  rest of the project uses and keep it.
- Avoid stacking more than three nouns in a row: "user authentication token
  refresh logic" forces the reader to unpack it backward. Rewrite with a
  preposition: "the logic that refreshes the token after user authentication".
- Prefer a plain verb over an -ing noun form when describing an action: "to
  configure the workspace", not "workspace configuration", when you mean the
  act of doing it.
- Write a sequence of steps as a numbered list, one action per line, not as a
  prose paragraph describing what happens in order.

### Where software terms fit

Neither source means strip out real technical vocabulary. ASD-STE100 restricts
general vocabulary to keep prose unambiguous, and Orwell's rule 5 targets
jargon, but a correct, precise software term is never the problem it is
guarding against. Use `commit`, `rebase`, `workspace`, `endpoint`, `NAPI`,
`IPC` exactly and consistently, the same way a maintenance manual keeps
"hydraulic actuator" instead of paraphrasing it into something vaguer. The
target is marketing jargon and invented abstraction ("synergistic tooling
layer", "solutioning"), not domain precision. If the reader needs the term to
do the task, keep it, use the correct one, and define it once on first
mention.

## Annotated exemplars

These are real passages from `web/learn/concepts/ai-engineering/ai-assisted-software-engineering/index.mdx`.
Study why each works, then write like this.

**Metaphor that carries the concept:**
> The developer's role shifts from the actor in the movie to the director
> orchestrating the AI actors, delegating implementation plans, refining and
> reviewing output.

Why it works: one metaphor does the explaining. No jargon, no definition needed.
The reader already knows what a director does, so the role shift lands instantly.

**Contrast that lands in one line:**
> Code that looks right is not the same as code that is right.

Why it works: parallel structure, one idea, the whole misconception corrected in
a single sentence. Nothing to cut.

**Mechanism stated plainly, misconception corrected without hedging:**
> The model is not performing logical reasoning about correctness, it is
> predicting plausibility.

Why it works: it says what the thing actually does, then contrasts it with what
readers assume it does. Declarative. No "it could be argued", no "somewhat".

**Now the same article's opening, which is slop. Do not write like this:**
> AI-assisted software engineering is all the rage right now, and rightfully so;
> it lets seasoned software developers multi-task, work away from the keyboard,
> and prototype ideas at lightning speed.

What is wrong: "all the rage" and "lightning speed" are hype with no information.
The semicolon should be two sentences. "rightfully so" is filler. The sentence
sells instead of explaining.

Rewrite:
> AI-assisted software engineering lets experienced developers multitask, work
> away from the keyboard, and prototype quickly. It also lowers the barrier for
> non-technical people to build software.

Same facts, no hype, no semicolon, and it now leads with what the reader gains.

## Voice rules

- Direct and declarative. One idea per sentence where you can.
- Active voice. "The service dispatches the alert", not "the alert is dispatched".
- Second person when addressing the reader.
- Mechanism before implication.
- Earn every metaphor. If it does not make an idea more concrete, cut it.
- If a word can come out without changing the meaning, take it out.
- Sentences aim for 20 words, 30 is the ceiling. Split anything longer.
- One name per concept, used consistently. Do not alternate synonyms for the
  same referent in one explanation. Keep precise software terms. Drop vague
  jargon. See "Foundational principles" above.
- No hedging or qualifiers: "quite", "fairly", "relatively", "somewhat".
- No apologetic openers: "it should be noted that", "it is worth mentioning".
- Paragraphs 3 to 4 sentences. Longer means break it up or use a list.
- Headings organize longer explanations. Do not use prose to transition between
  sections.
- Do not end a paragraph with a sentence shorter than three words. Fragments like
  "Coordinate those operations." or "Isolation is the fix." read as abrupt
  commands, not natural prose. Fold the point into the previous sentence or
  expand it.

## Hard bans: formatting

- No em dashes. Use a period, comma, or colon.
- No semicolons. Break into two sentences.
- No ALL CAPS.
- Minimal parentheses. If the information matters, give it a full sentence.
- Backticks for code, file paths, commands, and identifiers: `jj log`, `type`.

## Buzzword and marketing banlist

Do not use these. Rewrite to the plain version.

Words fall in two tiers. Tier 1 has near-zero legitimate use in this prose, so
remove every one. Tier 2 is context-dependent: sometimes fine, so check each hit
and keep it only if it carries real meaning.

**Tier 1 (remove):**

| Banned | Use instead |
| --- | --- |
| powerful, robust, elegant, seamless | describe what it actually does |
| leverage, utilize, harness | use |
| unlock, empower, supercharge, elevate | enable, let you |
| all the rage, game-changer, revolutionary | cut it, or state the concrete benefit |
| lightning speed, at the speed of light, blazing fast | fast, or give a number |
| bulletproof, rock-solid, unwavering | reliable, or state the guarantee |
| in order to | to |
| essentially, basically, fundamentally | cut it |
| a wide array of, a plethora of, myriad | many, or list them |
| rightfully so, needless to say | cut it |
| delve, dive deep, embark, uncover, unleash | cut, or use a plain verb |
| foster, bolster, garner, streamline, underscore, showcase | plain verb: build, increase, show |
| multifaceted, intricate, nuanced, meticulous, pivotal | specific, detailed, careful, or cut |
| tapestry, realm, landscape (figurative), ecosystem (figurative), symphony, beacon | name the actual thing |
| testament, boasts, nestled, renowned for, exemplifies, indelible | rewrite plainly |
| cutting-edge, state-of-the-art, world-class | cut it |
| agreed contract | plain boundary: shared interface, clear file ownership, or named dependency |
| contention | name the concrete collision: shared files, same checkout, or competing writers |

**Tier 2 (review, keep only if earned):** crucial, key, vital, significant,
essential, comprehensive, holistic, dynamic, innovative, transformative,
optimize, embrace, journey, paradigm, rich, profound, vibrant, interplay,
align with. Prefer a concrete claim over the adjective.

## AI-tell banlist

These patterns read as machine-generated. Avoid each one. They are grouped by
kind, and the checker script flags most of them.

**Rhetorical framing:**

- Antithesis scaffolding: "it's not just X, it's Y", "isn't just X", "not only X
  but also Y", "it's more than X, it's Y". Say the point directly.
- Repetitive negatives: "not X, not Y", stacking negations for rhythm. State what
  the thing is.
- Negative parallelism: "X rather than Y" as a rhythmic device. Just say X.
- Rule-of-three padding: "faster, cleaner, and more maintainable". Keep only the
  items that carry weight.
- Rhetorical question then answer: "The problem? Scale." State the point.
- Encompassing opener: "Whether you are new or experienced, ...". Cut the framing.
- Inspirational pivot: "at its core, this is about", "it's about humanity". Stay
  concrete.
- Colon drama: "delivers where it counts: visibility". Rewrite as one statement.
- Trailing purpose clause: ending a sentence with ", to help your team stay
  agile". Cut the vague rationale or make it specific.

**Transitions and openers:**

- Mechanical transitions as sentence openers: "Furthermore", "Moreover",
  "Additionally", "However", "Interestingly". Start with the subject.
- Throat-clearing: "It's important to note that", "It's worth mentioning".
- Scene-setting intros: "In today's fast-paced world", "In the ever-evolving
  landscape".
- "Let's dive in", "dive deep", "navigate the complexities of".
- Fake-empathy hooks: "Picture this", "Imagine that", "As a developer, you know".
- Assistant tics: "Great question", "Absolutely", "I'd be happy to help".

**Closings:**

- Section-ending restatements: "In summary", "To sum up", "In conclusion", "In
  essence", "At the end of the day", "Ultimately". End on the last real point.

**Attribution:**

- Vague attribution: "studies show", "experts say", "research suggests", "industry
  reports" without a real, checkable source. Cite the specific source or cut the
  claim. Never attribute a quote you cannot verify.

**Sentence construction:**

- Copula avoidance: "serves as", "stands as", "marks a", "represents a shift"
  where "is" is correct. Use "is".
- Superficial -ing clauses: "highlighting the significance", "underscoring the
  importance". Say what actually happens.
- "Despite its X, it faces challenges" formula. State the specific limitation.
- Hedge stacking: "may potentially possibly". Pick one or none.
- Monotonous rhythm: many sentences of the same length. Vary sentence length.

**Formatting:**

- Em-dash-per-sentence rhythm. Covered by the formatting ban, and it is a tell.
- Curly quotes and apostrophes. Use straight quotes.
- Bold for emphasis in running prose. Bold is for key terms on first mention only.
- Inline-header list rows: "- **Term:** description" as a listicle. Prefer prose
  or a table.

## Explaining in context

Match length and shape to the job.

| Job | Shape |
| --- | --- |
| Inline code comment | One or two short sentences. State why, not what the next line already shows. |
| Chat / clarify answer | Lead with the mechanism. Then one concrete example or consequence. Stop. |
| Explanatory doc section | Mechanism before implication. Headings carry structure. Banlists still apply. |
| Full site article | Follow this skill for voice, then the `writing` skill for skeleton and links. |

For comments: explain non-obvious intent, constraints, or invariants. Do not
narrate the code. "Retry on 429 because the upstream rate-limits by IP" earns
its keep. "Loop over the items" does not.

## Quick check before you return an explanation

1. One claim per sentence. Active voice. No word that can be cut.
2. No hard bans (em dash, semicolon, ALL CAPS), no Tier 1 buzzwords, no AI tells.
3. Precise software terms kept. Vague jargon dropped. One name per concept.
4. Mechanism stated before implication. Reader can act or understand without a
   second pass.
5. For longer drafts, run the checker script below.

## Readability checker script

`scripts/readability.py` is a dependency-free checker. Run it on any draft:

```bash
python3 .claude/skills/explain-to-me/scripts/readability.py path/to/doc.mdx
# --strict exits non-zero on a hard fail (em dash, semicolon, ALL CAPS,
# Tier 1 word, or em-dash rate over 3 per 500 words). Use in a hook or CI.
```

It masks frontmatter, code, and JSX (preserving line numbers), then reports:

- **Flesch Reading Ease** and Flesch-Kincaid grade. Aim for reading ease of 50 or
  higher and grade 12 or lower. Lower reading ease means the prose is too dense:
  shorten sentences and prefer shorter words.
- **Sentence-length variation** (coefficient of variation). A low value means a
  monotonous rhythm. Vary sentence length.
- **Em-dash rate** and **tell density**, both per 500 words, as at-a-glance
  scores.
- Every **hard ban** hit (em dash, semicolon, ALL CAPS) with line numbers.
- **Tier 1 vocabulary** (fail) and **Tier 2 vocabulary** (review) separately.
- Every **AI tell**: rhetorical framing, mechanical transitions, vague
  attribution, copula avoidance, and the rest of the banlist.
- **Curly quotes**, **trailing purpose clauses**, **inline-header list rows**,
  possibly-excessive **bold spans**, **Title Case headings**, **long
  sentences** over 30 words, and **short paragraph endings** under 3 words.

A clean draft reports no hard fails, no AI tells, and a Flesch Reading Ease at or
above 50. Tier 2 words and Title Case headings are review-only signals: the house
concept-doc headings are intentionally title case, so that flag is informational.

The banlists draw on published catalogues of AI writing tells: oliviacal.com, the
Forbes "Seven Tells of AI Writing", Wikipedia:Signs_of_AI_writing,
github.com/kdgbalmer/ai-tells, and dragonflyeditorial.com. The voice model itself
draws on Orwell's "Politics and the English Language" (1946) and ASD-STE100,
the Simplified Technical English standard maintained by ASD (AeroSpace and
Defence Industries Association of Europe).
