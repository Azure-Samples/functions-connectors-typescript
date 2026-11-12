# Sample smoke tests

Use Node.js 24+. Run `npm ci` followed by `npm test` from any sample app directory. Each app's test command builds its TypeScript source and runs the shared suite against that app's own dependencies.

To install, build, and test all eighteen apps from the repository root in PowerShell:

```powershell
$apps = 'azureblobApp\polling', 'azureblobApp\webhook', 'dataflowsApp', 'dataverseApp\polling', 'dataverseApp\webhook', 'genericApp\polling', 'genericApp\webhook', 'office365App\polling', 'office365App\webhook', 'onedriveApp\polling', 'onedriveApp\webhook', 'plannerApp', 'salesforceApp\webhook', 'sharepointApp\polling', 'sharepointApp\webhook', 'teamsApp\polling', 'teamsApp\webhook', 'vstsApp\webhook'
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
node --test .\tests\samples.test.mjs .\tests\blob-polling-setup.test.mjs .\tests\polling-setup.test.mjs .\tests\teams-setup.test.mjs .\tests\vsts-setup.test.mjs
```

On other platforms, install and build each app, then run the same Node test runner against [samples.test.mjs](samples.test.mjs) from the repository root.

The suite checks:

- Every connector-specific manifest, lockfile, and installed package uses the requested `@azure/connectors@0.4.0-preview`, `@azure/functions@^4.17.1`, and `@azure/functions-extensions-connectors@0.2.0-preview` releases, plus CommonJS and ESM SDK entry-point loading. Generic polling depends only on Functions; Generic webhook also uses the connector extension with a transitive SDK dependency.
- The extension and app resolve the same SDK installation, and host/deployment runtime settings match Node.js 24.
- All azd project names use schema-compliant lowercase slugs, and deployment ignore files protect local settings, azd state, and Azurite data.
- All 88 expected sample functions register through the connector extension or raw host API when all opt-ins are enabled. Independent Blob, Generic, Office 365, OneDrive, SharePoint, and Teams polling apps register without an enable flag.
- Generic apps use existing resources without provisioning or deployment hooks. Generic webhook uses the generic helper with default Webhook delivery; Generic polling uses the raw host binding. Both only log receipt and return no payload.
- Both Dataverse apps default to combined row changes only; action and separate-row flags are checked independently, including false and incorrectly cased values. Their templates use shared infrastructure, manual setup, ignored real local settings, and safe placeholder examples.
- The trigger samples call all 39 supported non-deprecated, non-duplicate public typed registration helpers. The expected API list is discovered from the installed extension, excluding the two deprecated SharePoint file helpers, the duplicate Office 365 calendar alias, and the Kusto callback helper (Kusto exposes connector actions rather than triggers).
- Both platform hooks for Office 365, OneDrive for Business, SharePoint, and Teams map registered function names to operation IDs from the installed SDK.
- SharePoint consumes a provisioned site URL without prompting or Graph discovery. Mocked setup checks five default subscriptions, all opt-ins, list/library and folder targeting, existing-trigger updates, opt-in deselection, and failure reporting without calling Azure.
- SharePoint polling setup covers all ten operations, authenticated picker dependencies, manual list-name fallback, unavailable required/optional selectors, nested folder navigation and URL encoding, saved selections, ownership checks, and safe source deselection. Run `npm test` from `sharepointApp/polling`; its README gives selected prompt examples rather than a full prompt inventory.
- Both Office 365 hooks subscribe only one function to the new-calendar operation and omit the deprecated webhook email operation.
- Office 365 polling setup authorizes the connection, creates an Inbox Poll source, reuses saved subscriptions, refuses unowned configurations, and reports consent/source-registration failures without applying incomplete settings.
- Both Teams hooks use the shared authenticated setup for seven additional operations from the installed SDK.
- Azure DevOps webhook setup covers Entra OAuth consent, required-only authenticated organization/project/repository/team/member pickers without optional-filter lookups, empty and failed required lookups, saved selections, callback-key rotation, source ownership, and non-destructive deselection for all nine operations.
- Teams Poll setup covers picker-ID dependencies, callback omission, optional-source selection/deselection, saved-input reuse, and lookup failures before source creation. Its sequential azd workflow is checked to prevent obscured setup prompts.
- Twelve payload scenarios per normalized handler: object and JSON batches, object and JSON single items, empty batches, missing bodies, null payloads, malformed JSON, mixed polling envelope arrays as objects and JSON, a polling envelope containing multiple items, and an empty polling array.
- Thirteen opaque-event scenarios per Generic polling, raw Dataverse, OneDrive content, and additional Teams Poll handler cover binary buffers, binary/text/JSON envelopes, raw text, JSON file contents, empty content, null/undefined payloads, malformed JSON, dynamic records, and object/JSON polling arrays. Generic only acknowledges receipt; the other raw handlers preserve payload identity. Event contents are never logged.
- Polling uses the exported `DeliveryMode` and `Cardinality` enums. The real Functions trigger builder supplies `Webhook` and `one` when omitted, single-event concurrency is separate from explicit `Many` batching, and webhook hooks do not provision polling listeners.
- Additional flat-record batch and single-item scenarios for dynamic SharePoint handlers in both delivery modes and Salesforce webhook handlers; logging must not depend on a generated `dynamicProperties` wrapper being present.
- Blob, OneDrive, SharePoint, and Teams Poll examples log only receipt and normalized counts. Their safe settings examples cover every listener and disable optional SharePoint and Teams sources by default.
- Items reach each handler in order, original payloads and polling metadata are preserved, calendar changes use `ActionType`, and malformed JSON produces a warning.

Host registration is intercepted and public helper calls are observed, but the real connector extension's normalization and typed-context wrappers still execute. These offline tests do not load local settings, need credentials, start a Functions host, call connector services, or provision resources. They do not replace end-to-end validation with authorized connections and live events.

`npm test` in `teamsApp/webhook` also runs [teams-setup.test.mjs](teams-setup.test.mjs). These offline tests exercise all three transcript/recording scopes, dynamic team/channel/chat/meeting pickers, selected-ID dependencies, free-form keyword/reaction inputs, nested `body` parameters, callback-URL omission, explicit skips, lookup failures, and setup ordering in both hooks. Dynamic request schemas are synthetic fixtures, not a claim about a tenant's live schema. No Azure operations run during these tests.

## Deployment configuration tests

Run the dependency-free PowerShell test runner after installing the sample dependencies:

```powershell
pwsh -File .\tests\trigger-configs.test.ps1
```

[trigger-configs.test.ps1](trigger-configs.test.ps1) isolates the hooks' trigger-array assignments and optional-setting branches without executing consent, CLI operations, or interactive setup. It checks twelve configuration scenarios against the SDK's required parameter names and value types, including all four OneDrive content/metadata operations using the selected folder and the original four Teams configurations before interactive setup, plus successful root/paged OneDrive folder traversal and explicit invalid-listing errors. Folder paths are compared with the actual SDK route construction, with requests and authentication disabled.

Connector-specific dynamic values, OAuth permissions, and live callback delivery still require authorized end-to-end testing.

## Registry and lockfile failures

If installation fails, do not substitute older packages or assume that previously installed dependencies validate the upgrade. The suite checks all three releases and lockfile consistency, so a handler-only success cannot hide stale dependencies. Use a trusted registry that resolves the requested versions, then regenerate lockfiles with `npm install` only after that registry is available.

The updated extension depends on `@azure/connectors@^0.4.0-preview`, so connector-specific apps pin the matching `0.4.0-preview` SDK and share that installation with the extension. Generic webhook receives the SDK transitively; Generic polling does not install it.

If these releases are not yet available in your registry, install trusted local tarballs from the chosen app directory without changing the portable version pins or lockfile:

```powershell
npm install --no-save --package-lock=false "C:\packages\azure-functions-4.17.1.tgz" "C:\packages\azure-connectors-0.4.0-preview.tgz" "C:\packages\azure-functions-extensions-connectors-0.2.0-preview.tgz"
npm test
```

Use the actual tarball locations on your machine. Do not commit machine-specific tarball paths or substitute older releases.

Salesforce webhook deployment tests in `webhook-setup.test.mjs` cover required-only object selection, OAuth status and redirect waits, callback-key handling, saved selections, ownership checks, safe reruns, and failure paths. Run them with `npm test` from `salesforceApp/webhook`.
