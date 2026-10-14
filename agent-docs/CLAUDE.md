# Agent documentation

The top level holds only `TODO.md` and this file. Everything else goes here:

- `architecture-decision-records/` — one decision and its reasons per file,
  named `NNNN-slug.md`. Read the relevant one before "simplifying" a design that
  looks accidental.
- `todo/` — committed work, one file per item with `metadata.category`, `area`,
  `first_move` and `order`; `TODO.md` indexes them.
- Tried and declined → a sentence at the code that would re-try it, with the
  number, or an ADR if the decision deserves a record.
- What a session did and which commits → git already holds it.

Cite a doc by its path, so that after a move a grep for the old path finds every
citation.
