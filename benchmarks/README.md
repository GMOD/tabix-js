# Tabix Benchmarks

This directory contains performance benchmarks for tabix-js.

## Running Benchmarks

To compare the current branch against `origin/master`:

```bash
yarn bench
```

To compare specific branches:

```bash
BRANCH1=origin/master BRANCH2=my-feature-branch yarn bench
```

Or specify branches directly:

```bash
./scripts/build-both-branches.sh origin/master my-feature-branch && yarn benchonly
```

## How it Works

1. The `build-both-branches.sh` script checks out two branches and builds them
2. The builds are placed in `esm_branch1/` and `esm_branch2/`
3. The benchmark file imports from both builds and runs them side-by-side
4. Vitest bench displays comparative performance results

## Benchmark Files

- `tabix.bench.ts` - Benchmarks tabix file reading performance across various
  file sizes
- `overall.bench.ts` - Quick benchmark for parsing a large VCF file
- `string-comparison.bench.ts` - Compares different string parsing algorithms
  (not branch comparison, compares algorithms)
- `profile-cpu.mjs` - CPU profiling script for detailed performance analysis

The benchmarks test a range of file sizes from small (2KB) to large (213MB)
files, including:

- VCF files
- BED files
- GFF files

This helps identify performance characteristics across different workloads.
