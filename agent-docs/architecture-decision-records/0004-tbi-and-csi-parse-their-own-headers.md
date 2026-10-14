# ADR 0004 — `tbi.ts` and `csi.ts` each parse their own header block

Status: Accepted (rejects the refactor)

## Context

Two functions read the 28-byte tabix header block (`formatFlags`,
`columnNumbers`, `metaChar`, `skipLines`, `nameSectionLength`, then the name
section): `tbi.ts`'s `_parse` and `csi.ts`'s `parseAuxData`. The two copies look
like textbook duplication, and extracting them into a shared `IndexFile` method
is a recurring suggestion.

## Decision

Leave the two parsers independent.

We tried the shared method (`a4c02e5`) and reverted it. It saved ~47 lines and
cost more than it saved:

- each parser stopped being readable top to bottom, because following it means
  jumping to a base-class helper;
- the call sites got awkward — `.parseTabixHeader(bytes, 16).header`;
- and the "duplication" is the **on-disk file format**, not logic. The spec
  fixes those offsets, so the two copies cannot diverge the way copied logic
  can, and the coupling a helper would add gains nothing.

## Consequences

Treat the two parsers as independent and acceptable as they are. Per-file
cleanups — clearer comments, fewer intermediate variables — are welcome;
hoisting the parsing into a shared helper is not.
