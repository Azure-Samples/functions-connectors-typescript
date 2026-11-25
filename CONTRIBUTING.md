# Contributing

Keep changes focused on the affected connector and delivery mode. Each `polling/` or `webhook/` app must remain standalone: keep its dependencies, configuration, infrastructure, setup scripts, and README in that folder. Update the README when trigger behavior, prerequisites, or setup changes.

## Local checks

Use Node.js 24 or later. From every changed sample folder, run:

```bash
npm ci --no-audit
npm run build
npm audit --audit-level=high
```

The build runs TypeScript compilation and typechecking; audit runs explicitly after installation instead of making a redundant implicit request. Use the existing scripts; do not upgrade unrelated dependencies or suppress audit findings just to make a check pass. Commit the sample's `package-lock.json` when intentionally changing dependencies. Keep verification-only tests and generated output outside the checkout.

Build success is not real-event verification. If you intentionally test deployment or connector events, follow that folder's README with your own authorized test resources, record the delivery mode and outcome, and clean up resources. These checks are not part of CI.

## Pull requests and reports

Describe the affected sample paths, behavior change, checks run, and any known limitations. Update [CHANGELOG.md](CHANGELOG.md) under Unreleased for user-facing changes. Use the issue and PR templates; redact logs and payloads before attaching them.

Never commit `local.settings.json`, `.azure/`, `.env` files, access tokens, system keys, authenticated callback URLs, or private connector data. Use the checked-in settings examples with placeholders instead. Report suspected vulnerabilities privately through [Microsoft Security Response Center](https://msrc.microsoft.com/report/), not a public issue.

## GitHub Actions

CI (`.github/workflows/ci.yml`) runs `npm ci --no-audit`, the existing build script, and an explicit npm audit for all standalone apps, including generic examples. A separate job downloads the Gitleaks v8.30.1 CLI, verifies its SHA-256 hash before extraction, and scans a `git archive HEAD` snapshot. This is current-source scanning only: it excludes Git history and ignored local files such as `local.settings.json`.

To scan locally before opening a PR, run `gitleaks dir <folder> --redact --no-banner` against a copy of the files you intend to commit; avoid scanning ignored private settings.

The workflow uses immutable action pins, read-only `contents` permission, and disables persisted checkout credentials. It requires no configured repository or organization secrets and does not start Functions, sign in to Azure, deploy resources, or invoke live connectors.

## Microsoft Learn metadata

Keep HTML-comment-wrapped YAML at the start of runnable connector-specific polling/webhook READMEs. Use `page_type: sample`, languages `typescript`, `bicep`, and `azdeveloper` only when present, products `azure` and `azure-functions`, and a stable unique `urlFragment` ending in `typescript`. Keep names and descriptions under 150 characters. Do not add sample metadata to overview/generic guides or explicitly unvalidated scaffolds.
