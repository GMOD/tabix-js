# Contributing

## Development

```sh
pnpm install
pnpm test
pnpm build
```

Use `pnpm version patch/minor/major` to release — it runs lint, format, types,
tests and build, regenerates CHANGELOG.md with git-cliff, then pushes the
version tag which triggers the publish workflow.

[docs/api.md](docs/api.md) is written by hand, and `test/apiDocs.test.ts` fails
when a public member of `TabixIndexedFile`, `TBI`, `CSI`, `VirtualOffset`, or an
export, is missing from it. Document the new member, or add it to the test's
`undocumented` list with the reason it is internal.

`docs/img/dataflow.svg` is generated from `docs/img/dataflow.dot` and committed,
since GitHub does not render DOT. If you edit the `.dot`, re-render it in the
same commit:

```sh
dot -Tsvg docs/img/dataflow.dot -o docs/img/dataflow.svg
```

Re-rendering is a manual step, because graphviz is not a dependency and
different graphviz versions emit different SVG bytes. An automated comparison
would fail whenever the graphviz version changed, even with an up-to-date
diagram.

## Publishing

Releases publish automatically via GitHub Actions using npm trusted publishing
(OIDC, no stored token). The workflow requires `--provenance` and
`id-token: write` permissions.

The repo has no `prepublishOnly` script on purpose. `preversion` runs the checks
locally and the publish job's `needs: test` runs them in CI, so a
`prepublishOnly` would run lint/test/build a third time per release.

This repo is already configured. To set up a new package, run
`npm trust github <pkg> --file publish.yml --repo GMOD/<repo>` (requires
npm >=11.10.0 and 2FA).

Once npm publish succeeds, the `release` job creates the GitHub release for the
tag. `scripts/release-notes.sh` extracts the notes from that version's
CHANGELOG.md section, so run it with a version to preview a release's notes.
