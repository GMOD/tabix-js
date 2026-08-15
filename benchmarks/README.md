# Tabix Benchmarks

## Running Benchmarks

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

## How it Works

1. `scripts/build-both-branches.sh` builds each ref in a throwaway git worktree,
   so your own checkout is never switched — but each ref is built as committed,
   so commit before benchmarking
2. The builds land in `esm_branch1/` and `esm_branch2/`, alongside a
   `branchname.txt` the benchmark labels each side with
3. `tabix.bench.ts` imports both builds and runs them side by side

The two directories stick around afterwards, so a bare `pnpm benchonly` will
compare whatever was built there last.

## Benchmark Files

- `tabix.bench.ts` — reading performance across file sizes, comparing the two
  builds above
- `checkLine.bench.ts` — compares line-filtering implementations against each
  other, not two branches
- `profile-cpu.mjs` — CPU profiling for detailed analysis

The files range from 2KB to 213MB and cover VCF, BED and GFF, so the results
show performance across different workloads.
