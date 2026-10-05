# Agent documentation

Top level is exactly `TODO.md` and this file. Everything else is filed:

- `architecture-decision-records/` — *why*, one per file, `NNNN-slug.md`. Read
  the relevant one before "simplifying" a design that looks accidental.
- `todo/` — committed work, one file per item with `metadata.category`,
  `area`, `first_move` and `order`; `TODO.md` indexes them.
- Tried and declined → a sentence at the code that would re-try it, with the
  number, or an ADR if the decision deserves a record.
- What a session did and which commits → git already holds it.

Cite a doc by its path, so a move is a grep.
