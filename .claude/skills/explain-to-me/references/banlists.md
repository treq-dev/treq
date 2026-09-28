# Banlists

Part of the `explain-to-me` skill. `scripts/readability.py` flags most of these automatically.

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

## Sources

The banlists draw on published catalogues of AI writing tells: oliviacal.com, the
Forbes "Seven Tells of AI Writing", Wikipedia:Signs_of_AI_writing,
github.com/kdgbalmer/ai-tells, and dragonflyeditorial.com. The voice model itself
draws on Orwell's "Politics and the English Language" (1946) and ASD-STE100,
the Simplified Technical English standard maintained by ASD (AeroSpace and
Defence Industries Association of Europe).
