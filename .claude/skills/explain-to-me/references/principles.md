# Foundational principles

Part of the `explain-to-me` skill. The voice rules in `SKILL.md` are the short form of this page.

This voice is built on two sources: George Orwell's rules for clear prose, and
ASD-STE100 (Simplified Technical English), the standard aircraft-maintenance
writers use so a technical sentence cannot be misread. treq prose is lower
stakes than a maintenance manual, but the same discipline makes an explanation
easier to skim and harder to misread. Apply both to every draft.

## Orwell's six rules

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

## ASD-STE100 (Simplified Technical English)

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

## Where software terms fit

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
