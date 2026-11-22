# Release integrity

Security's review of DX-RFC-001 (2026-11-17) made these mandatory before the first official release: branch protection, CODEOWNERS, npm trusted publishing (OIDC) instead of `NPM_TOKEN`, signed container images with an SBOM and provenance, and a full pen test. This page says what is in the repository and what someone with admin rights must set in GitHub and npm.

## In the repository

| Control | Where | State |
|---|---|---|
| CODEOWNERS | `.github/CODEOWNERS` | Done. Every path is owned by `@michaelrowlandftw`; security-sensitive paths are listed separately so Security's team can be added to them |
| npm trusted publishing (OIDC) | `.github/workflows/publish.yml` | Done. No `NPM_TOKEN`; `id-token: write`; npm 11.6.2 publishes with provenance automatically |
| No pushes to `main` from CI | `.github/workflows/publish.yml` | Done. The manual version-bump path was removed: a release starts from a GitHub release on a tag made after a version-bump pull request |
| Signed image, SBOM, provenance | `.github/workflows/docker.yml` | Done. BuildKit SBOM and `provenance: mode=max` attestations; keyless cosign signature by digest |
| Actions pinned by commit SHA | all workflows | Done (cosign-installer v4.1.1 added) |
| Pen test | - | **Open: Security to arrange** |

None of the release workflows has run yet. The first release should be checked by hand: `npm view mcp-flutterwave --json` shows the provenance attestation, and `cosign verify` (command in `docker.yml`) passes for the image digest.

## What an admin must set (not possible from the repository)

GitHub, repository settings for `michaelrowlandftw/mcp-flutterwave` (and later the official repository):

1. **Branches → Add branch ruleset** for `main`:
   - Require a pull request before merging, 1 approval, **require review from Code Owners**, dismiss stale approvals on new commits.
   - Require status checks to pass: `Test and build (Node 22.x)`, `Test and build (Node 24.x)`, `Dependency audit`.
   - Block force pushes and deletions. Do not allow bypass (admins included), or limit bypass to a named release manager.
   - Require signed commits (optional; Security did not ask for it).
2. **Tags ruleset** for `v*`: only maintainers may create tags, so only they can start a release.
3. **Actions → General**: workflow permissions "Read repository contents" by default (the workflows ask for what they need); disallow Actions from approving pull requests.
4. **Environments** (optional, recommended): an environment `release` with required reviewers, and `environment: release` on the publish and docker jobs, so a person approves every release run.
5. **Secrets**: delete `NPM_TOKEN` once trusted publishing works. No other secret is needed by the release workflows.

npm, package settings for `mcp-flutterwave` on npmjs.com:

6. **Trusted publishers → GitHub Actions**: organisation or user, repository, workflow file `publish.yml` (and the `release` environment if set in step 4).
7. **Publishing access**: "Require two-factor authentication and disallow tokens", once the first OIDC publish has worked.

GitHub Container Registry:

8. Make the `mcp-flutterwave` package's visibility match the release plan, and link it to the repository so its access follows repository roles.

## Upstream

The package name, `mcpName` and repository URL in `package.json` still point at Abraham's upstream (`bajoski34/mcp-flutterwave`). Publishing from this fork would need either those changed or the work reconciled upstream first; the plan is to reconcile with upstream before any release (STATUS in flw-api-monitor, decision of 2026-11-22). Trusted publishing is configured per repository, so the npm setting in step 6 must name whichever repository finally publishes.
