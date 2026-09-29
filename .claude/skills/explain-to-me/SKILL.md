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
weight. Make each sentence mean only one thing. `references/principles.md` covers both,
plus where software terminology is exempt.

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
  jargon. See `references/principles.md`.
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
2. No hard bans (em dash, semicolon, ALL CAPS), no Tier 1 buzzwords, no AI tells
   (`references/banlists.md`).
3. Precise software terms kept. Vague jargon dropped. One name per concept.
4. Mechanism stated before implication. Reader can act or understand without a
   second pass.
5. For longer drafts, run the checker script below.

## References

Load these when the task needs them, not up front:

- `references/banlists.md`: Tier 1 and Tier 2 buzzwords with replacements, and the full AI-tell catalogue. Read before drafting anything longer than a code comment, or when the checker flags a hit you need to fix.
- `references/principles.md`: Orwell's six rules, the ASD-STE100 rules, and where software terms are exempt. Read when a rule above is unclear or you need to justify an edit.
- `references/exemplars.md`: annotated good and bad passages from a real treq article. Read when drafting a new article or when the voice is not landing.

## Readability checker script

`scripts/readability.py` is a dependency-free checker. Run it on any draft:

```bash
python3 .claude/skills/explain-to-me/scripts/readability.py path/to/doc.mdx
# --strict exits non-zero on a hard fail (em dash, semicolon, ALL CAPS,
# Tier 1 word, or em-dash rate over 3 per 500 words). Use in a hook or CI.
```

The checker reports Flesch Reading Ease and grade, sentence-length variation,
em-dash and tell density, and every hard-ban, banlist, and AI-tell hit with
line numbers. A clean draft has no hard fails, no AI tells, and reading ease at
or above 50. Tier 2 words and Title Case headings are review-only signals.
