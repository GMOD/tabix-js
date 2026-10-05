# ADR 0004 — `tbi.ts` and `csi.ts` each parse their own header block

Status: Accepted (rejects the refactor)

## Context

The 28-byte tabix header block — `formatFlags`, `columnNumbers`, `metaChar`,
`skipLines`, `nameSectionLength`, then the name section — is read in two places,
`tbi.ts`'s `_parse` and `csi.ts`'s `parseAuxData`. It reads as textbook
duplication, and extracting it onto a shared `IndexFile` method is a recurring
suggestion.

## Decision

Leave the two parsers independent.

This was tried (`a4c02e5`) and reverted. It saved ~47 lines and cost more than
it saved:

- each parser stopped being readable top to bottom, because following it means
  jumping to a base-class helper;
- the call sites got awkward — `.parseTabixHeader(bytes, 16).header`;
- and the "duplication" is the **on-disk file format**, not logic. Those offsets
  are fixed by the spec. They cannot drift apart in the way shared code exists
  to prevent, so the coupling a helper would create buys nothing.

## Consequences

Treat the two parsers as independent and acceptable as they are. Per-file
cleanups — clearer comments, fewer intermediate variables — are welcome;
hoisting the parsing into a shared helper is not.
