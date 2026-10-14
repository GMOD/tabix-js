# Tabix benchmarks

## Running benchmarks

To compare your HEAD against `origin/main`:

```bash
pnpm bench
```

To compare specific refs:

```bash
BRANCH1=origin/main BRANCH2=my-feature-branch pnpm bench
```

Or build them yourself, then run the benchmarks as often as you like:

```bash
./scripts/build-both-branches.sh origin/main my-feature-branch && pnpm benchonly
```

## How it works

1. `scripts/build-both-branches.sh` builds each ref in a throwaway git worktree,
   so the script never switches your checkout. It builds each ref as committed,
   so commit before benchmarking
2. The script writes the builds to `esm_branch1/` and `esm_branch2/`, alongside
   a `branchname.txt` that the benchmark reads to label each side
3. `tabix.bench.ts` imports both builds and runs them side by side

The script leaves `esm_branch1/` and `esm_branch2/` in place, so a bare
`pnpm benchonly` compares whatever the script last built there.

## Benchmark files

- `tabix.bench.ts` — reading performance across file sizes, comparing the two
  builds above
- `checkLine.bench.ts` — compares line-filtering implementations against each
  other, not two branches
- `profile-cpu.mjs` — CPU profiling for detailed analysis

The files range from 2KB to 213MB and cover VCF, BED and GFF.
