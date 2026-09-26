# Auto-merge safety gate

The repository is prepared for auto-merge through two workflows:

- `CI` installs the locked npm dependencies, audits production dependencies, builds the server and client, lints the repository, builds and scans the production container, smoke-tests the container, and reviews pull-request dependency changes.
- `CodeQL` performs extended security analysis for JavaScript and TypeScript on pull requests, `main`, merge-queue commits, and a weekly schedule.

All third-party GitHub Actions are pinned to immutable commit SHAs. Renovate keeps those pins current.

## Required GitHub settings

Create a branch ruleset for `main` with the following settings:

1. Require a pull request before merging.
2. Require branches to be up to date before merging, or enable the merge queue.
3. Require these status checks:
   - `Merge gate`
   - `Analyze (javascript-typescript)`
4. Require conversation resolution.
5. Block force pushes and branch deletion.
6. Enable repository auto-merge.

`Merge gate` is the stable aggregate check. It cannot pass unless every applicable CI job succeeds. Dependency review is intentionally skipped outside pull requests, while the other checks run for pull requests, `main`, and merge-queue commits.

## Renovate policy

Renovate may auto-merge patch, pin, and digest updates after three days and minor updates after seven days. All required checks still have to pass. Major updates are never auto-merged. Lock-file maintenance may auto-merge after the required checks pass.

## Local verification

Run the application checks locally with:

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run build
```

The CI runner uses Node.js 24.
