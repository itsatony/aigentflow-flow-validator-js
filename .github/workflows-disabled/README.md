# Why this workflow is disabled

GitHub Actions is off for this repository — both because the workflow file lives
here rather than in `.github/workflows/`, **and** at the repository level
(`actions.enabled: false`). Either alone is not enough: moving the file makes
_this_ workflow inert, but any workflow added later would have started reporting
again with no signal that the repo had decided against it.

This mirrors the decision in the reference implementation (`aigentflow`), where
hosted CI is disabled and `make ci-local` is the only gate.

## What replaces it

`npm run ci` — `typecheck → lint → format:check → test → build`. The workflow
above did nothing else: it checked out, `npm ci`, and invoked that same script.
So the script _is_ the specification, and this file is kept as the artefact it
is compared against, not as dead weight.

The one thing the workflow did that the local gate does not is the Node version
matrix (20.x and 22.x). Node 20 reached end-of-life in April 2025 and GitHub has
deprecated its Node-20 runners, so `engines` was narrowed to `>=22` — the
version the local gate actually runs. Declare only what is tested.

## What makes the local gate actually run

`.githooks/pre-push`, wired up by the `prepare` script (`git config
core.hooksPath .githooks`) on `npm install`. This was added because
`CONTRIBUTING.md` had said "MUST pass before you push" for the whole life of the
repo while four consecutive pushes — `main` among them — went out with
`prettier --check` failing.

## Re-enabling

```bash
git mv .github/workflows-disabled/ci.yml .github/workflows/ci.yml
gh api -X PUT repos/itsatony/aigentflow-flow-validator-js/actions/permissions -F enabled=true -f allowed_actions=all
```

Restore `engines` to `>=20` only if a runner will actually exercise Node 20.
