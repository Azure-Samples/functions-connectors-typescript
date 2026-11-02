# Sample smoke tests

Use Node.js 24+. Run `npm ci` followed by `npm test` from any sample app directory. Each app's test command builds its TypeScript source and runs the shared suite against that app's own dependencies.

To install, build, and test all eleven apps from the repository root in PowerShell:

```powershell
$apps = 'azureblobApp', 'dataflowsApp', 'genericApp', 'kustoApp', 'office365App', 'onedriveApp', 'plannerApp', 'salesforceApp', 'sharepointApp', 'teamsApp', 'vstsApp'
foreach ($app in $apps) {
    Push-Location $app
    try {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw "Installation failed for $app" }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Build failed for $app" }
    } finally {
        Pop-Location
    }
}
node --test .\tests\samples.test.mjs
```

On other platforms, install and build each app, then run the same Node test runner against [samples.test.mjs](samples.test.mjs) from the repository root.

The suite checks:

- Every manifest, lockfile, and installed package uses the requested `@azure/connectors@0.3.1-preview`, `@azure/functions@^4.17.0`, and `@azure/functions-extensions-connectors@0.1.0-preview` releases, plus CommonJS and ESM SDK entry-point loading.
- The extension and app resolve the same SDK installation, and host/deployment runtime settings match Node.js 24.
- All 49 expected sample functions register through the actual connector extension.
- The samples actually call all 43 public typed registration helpers, including the calendar alias and Kusto callback helper. The expected API list is discovered from the installed extension, not inferred from handler names.
- Both platform hooks for Office 365, OneDrive for Business, SharePoint, and Teams map registered function names to operation IDs from the installed SDK.
- Eight payload scenarios per handler: object and JSON batches, object and JSON single items, empty batches, missing bodies, null payloads, and malformed JSON.
- Additional flat-record batch and single-item scenarios for all ten dynamic SharePoint and Salesforce handlers; logging must not depend on a generated `dynamicProperties` wrapper being present.
- Items reach each handler, original payloads are preserved, calendar changes use `ActionType`, and malformed JSON produces a warning.

Host registration is intercepted and public helper calls are observed, but the real connector extension's normalization and typed-context wrappers still execute. These offline tests do not load local settings, need credentials, start a Functions host, call connector services, or provision resources. They do not replace end-to-end validation with authorized connections and live events.

The complete Node suite contains 472 checks, including 412 handler payload scenarios.

## Deployment configuration tests

Run the dependency-free PowerShell test runner after installing the sample dependencies:

```powershell
pwsh -File .\tests\trigger-configs.test.ps1
```

[trigger-configs.test.ps1](trigger-configs.test.ps1) isolates the hooks' trigger-array assignments and optional-setting branches without executing consent, CLI operations, or interactive setup. It checks eleven configuration scenarios against the SDK's required parameter names and value types, plus successful root/paged OneDrive folder traversal and explicit invalid-listing errors. Folder paths are compared with the actual SDK route construction, with requests and authentication disabled.

Connector-specific dynamic values, OAuth permissions, and live callback delivery still require authorized end-to-end testing.

## Registry and lockfile failures

If installation fails, do not substitute older packages or assume that previously installed dependencies validate the upgrade. The suite checks all three releases and lockfile consistency, so a handler-only success cannot hide stale dependencies. Use a trusted registry that resolves the requested versions, then regenerate lockfiles with `npm install` only after that registry is available.

The updated extension depends on `@azure/connectors@^0.3.1-preview`, so it shares the apps' direct `0.3.1-preview` SDK rather than installing the previous separate preview SDK.