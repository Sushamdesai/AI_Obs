# Branching Strategy

## Branch model

- `main` — stable integration branch.
- `feature/<short-name>` — work for a single deliverable or capability.
- `fix/<issue>` — defects and urgent hotfixes.
- `docs/<topic>` — documentation changes.
- `demo/<scenario>` — demo-specific scenario work.

## Rules

- Rebase or merge from `main` before merging feature work.
- Require at least one reviewer for all non-trivial changes.
- Keep architecture decisions in a design-meaningful commit separately from implementation details when possible.
- Preserve shared contracts and use them as a compatibility boundary.
