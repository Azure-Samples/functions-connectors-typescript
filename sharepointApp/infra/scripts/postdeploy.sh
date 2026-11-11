#!/bin/bash
# Post-deployment configuration for the sharepointApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Create one Connector Namespace trigger config per Functions trigger
#      in this app, each POSTing to the function's connector webhook URL.
#   2. Walk the operator through OAuth consent for the SharePoint Online
#      connection.

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Post-deployment configuration...${NC}"

if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required for this script. Please install jq.${NC}"
    exit 1
fi

# --- Read azd outputs --------------------------------------------------------
outputs=$(azd env get-values --output json)

resourceGroupName=$(echo "$outputs" | jq -r '.resourceGroupName')
connectorNamespaceName=$(echo "$outputs" | jq -r '.connectorNamespaceName')
sharepointConnectionName=$(echo "$outputs" | jq -r '.sharepointConnectionName')
functionAppName=$(echo "$outputs" | jq -r '.functionAppName')

if [[ -z "$resourceGroupName" || -z "$connectorNamespaceName" || -z "$sharepointConnectionName" || -z "$functionAppName" ]]; then
    echo -e "${RED}ERROR: required azd outputs missing. Run 'azd provision' first.${NC}"
    exit 1
fi

# --- Required SharePoint identifiers ----------------------------------------
sharepointSiteAddress=$(echo "$outputs" | jq -r '.sharepointSiteUrl // empty')

if [[ -z "$sharepointSiteAddress" ]]; then
    echo -e "${RED}ERROR: Missing provisioned SharePoint site URL.${NC}" >&2
    echo "Set SHAREPOINT_SITE_URL with 'azd env set', then run 'azd provision' before rerunning this hook." >&2
    exit 1
fi

# --- Verify the connector-namespace az CLI extension is installed ----------
extInstalled="$(az extension show --name connector-namespace --query name -o tsv 2>/dev/null || true)"
if [[ -z "$extInstalled" ]]; then
    echo -e "${RED}ERROR: 'connector-namespace' Azure CLI extension is not installed.${NC}" >&2
    echo -e "${RED}       Download the latest 'connector_namespace-*.whl' from${NC}" >&2
    echo -e "${RED}       https://github.com/Azure/Connectors/releases and run:${NC}" >&2
    echo -e "${RED}         az extension add --source <wheel-url-or-path>${NC}" >&2
    echo -e "${RED}       Then re-run: azd hooks run postdeploy${NC}" >&2
    exit 2
fi

# --- Authorize the SharePoint connection (OAuth consent) -------------------
echo ""
echo -e "${YELLOW}Authorizing SharePoint Online connection via Azure CLI...${NC}"

open_url() {
    local url="$1"
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 || true
    elif command -v wslview >/dev/null 2>&1; then
        wslview "$url" >/dev/null 2>&1 || true
    fi
}

connection_exists() {
    local connectionName="$1"
    az connector-namespace connection show \
        -g "${resourceGroupName}" --namespace "${connectorNamespaceName}" \
        -n "${connectionName}" -o none 2>/dev/null
}

create_sharepoint_connection() {
    local connectionName="$1"
    echo -e "${YELLOW}-> Creating SharePoint connection '${connectionName}' on namespace '${connectorNamespaceName}'...${NC}"
    if ! az connector-namespace connection create \
        -g "${resourceGroupName}" \
        --namespace "${connectorNamespaceName}" \
        -n "${connectionName}" \
        --connector-name 'sharepointonline'; then
        echo -e "${RED}   Failed to create connection '${connectionName}'.${NC}"
        return 1
    fi

    local fnPrincipalId
    fnPrincipalId=$(az functionapp identity show -g "${resourceGroupName}" -n "${functionAppName}" --query principalId -o tsv 2>/dev/null || echo "")
    local tenantId
    tenantId=$(az account show --query tenantId -o tsv)
    if [[ -n "$fnPrincipalId" ]]; then
        echo -e "${CYAN}   Granting function-app MI (${fnPrincipalId}) access to connection...${NC}"
        az connector-namespace connection access-policy create \
            -g "${resourceGroupName}" \
            --namespace "${connectorNamespaceName}" \
            --connection-name "${connectionName}" \
            -n 'functionapp-msi' \
            --principal-type 'ActiveDirectory' \
            --principal-object-id "${fnPrincipalId}" \
            --principal-tenant-id "${tenantId}" 2>/dev/null || true
    fi

    local userPrincipalId
    userPrincipalId=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || echo "")
    if [[ -n "$userPrincipalId" ]]; then
        echo -e "${CYAN}   Granting deployer user (${userPrincipalId}) access to connection...${NC}"
        az connector-namespace connection access-policy create \
            -g "${resourceGroupName}" \
            --namespace "${connectorNamespaceName}" \
            --connection-name "${connectionName}" \
            -n 'dev-user' \
            --principal-type 'ActiveDirectory' \
            --principal-object-id "${userPrincipalId}" \
            --principal-tenant-id "${tenantId}" 2>/dev/null || true
    fi
}

authorize_connection() {
    local connectionName="$1"
    local description="$2"

    echo -e "${CYAN}-> Authorizing ${description} connection: ${connectionName}${NC}"

    if ! connection_exists "${connectionName}"; then
        echo -e "${YELLOW}   Connection '${connectionName}' not found on namespace '${connectorNamespaceName}'.${NC}"
        if ! create_sharepoint_connection "${connectionName}"; then
            return 1
        fi
    fi

    local currentStatus
    currentStatus=$(az connector-namespace connection show \
        -g "${resourceGroupName}" --namespace "${connectorNamespaceName}" \
        -n "${connectionName}" --query "properties.overallStatus" -o tsv 2>/dev/null || echo "")
    if [[ "$(echo "$currentStatus" | tr '[:upper:]' '[:lower:]')" == "connected" ]]; then
        echo -e "${GREEN}   already Connected; skipping consent flow${NC}"
        return 0
    fi

    local params consentJson link
    params='[{"parameterName":"token","redirectUrl":"https://portal.azure.com"}]'
    consentJson=""
    for i in 1 2 3 4 5; do
        consentJson=$(az connector-namespace connection list-consent-links \
            -g "${resourceGroupName}" --namespace "${connectorNamespaceName}" \
            --connection-name "${connectionName}" --parameters "${params}" -o json 2>/dev/null || echo "")
        if [[ -n "$consentJson" ]]; then break; fi
        echo -e "${YELLOW}   list-consent-links attempt $i failed; retrying in 5s...${NC}"
        sleep 5
    done
    link=$(echo "${consentJson}" | jq -r '.value[0].link // .link // empty' 2>/dev/null || echo "")
    if [[ -z "${link}" ]]; then
        echo -e "${RED}   list-consent-links returned no link${NC}"
        return 1
    fi

    echo -e "${CYAN}   opening browser for OAuth consent...${NC}"
    echo -e "${CYAN}   (if no tab opens, paste this URL manually:${NC}"
    echo -e "${CYAN}      ${link})${NC}"
    open_url "${link}"

    local deadline=$(($(date +%s) + 300))
    local lastStatus=""
    local s=""
    while [[ $(date +%s) -lt $deadline ]]; do
        s=$(az connector-namespace connection show \
            -g "${resourceGroupName}" --namespace "${connectorNamespaceName}" \
            -n "${connectionName}" --query "properties.overallStatus" -o tsv 2>/dev/null || echo "")
        if [[ "$s" != "$lastStatus" ]]; then
            echo -e "${CYAN}   status: ${s:-?}${NC}"
            lastStatus="$s"
        fi
        if [[ "$(echo "$s" | tr '[:upper:]' '[:lower:]')" == "connected" ]]; then
            echo -e "${GREEN}   ✓ ${connectionName} authenticated${NC}"
            return 0
        fi
        sleep 3
    done
    echo -e "${YELLOW}   timed out waiting for consent (5 min).${NC}"
    return 1
}

if ! authorize_connection "${sharepointConnectionName}" "SharePoint Online"; then
    echo ""
    echo -e "${RED}ERROR: SharePoint connection is not Connected. Cannot create triggers.${NC}"
    echo -e "${RED}       Complete the OAuth consent flow, then re-run: azd hooks run postdeploy${NC}"
    exit 1
fi

# --- Create Connector Namespace trigger configs -----------------------------
echo ""
echo -e "${CYAN}Fetching connector extension key for ${functionAppName}...${NC}"
connectorExtensionKey=$(az functionapp keys list -g "${resourceGroupName}" -n "${functionAppName}" --query "systemKeys.connector_extension" -o tsv)
if [[ -z "$connectorExtensionKey" ]]; then
    echo -e "${RED}ERROR: could not fetch connector_extension system key from ${functionAppName}.${NC}"
    exit 1
fi

connectionDetails=$(jq -nc --arg conn "${sharepointConnectionName}" \
    '{connectorName:"sharepointonline", connectionName:$conn}')

# functionName | operationName | parameters JSON
triggers=()

sharepointLibraryName=$(echo "$outputs" | jq -r '.sharepointLibraryName')
sharepointListName=$(echo "$outputs" | jq -r '.sharepointListName')
sharepointFolderPath=$(echo "$outputs" | jq -r '.sharepointFolderPath // empty')
sharepointEnableDeletionTriggers=$(echo "$outputs" | jq -r '.sharepointEnableDeletionTriggers // false')
sharepointEnableSyntexTrigger=$(echo "$outputs" | jq -r '.sharepointEnableSyntexTrigger // false')
sharepointFormId=$(echo "$outputs" | jq -r '.sharepointFormId // empty')
sharepointDigestSchedule=$(echo "$outputs" | jq -r '.sharepointDigestSchedule // empty')

listParameters=$(jq -nc --arg d "$sharepointSiteAddress" --arg l "$sharepointListName" '[{name:"dataset",value:$d},{name:"table",value:$l}]')
libraryParameters=$(jq -nc --arg d "$sharepointSiteAddress" --arg l "$sharepointLibraryName" --arg f "$sharepointFolderPath" \
    '[{name:"dataset",value:$d},{name:"table",value:$l}] + (if $f == "" then [] else [{name:"folderPath",value:$f}] end)')
triggers+=(
    "OnSharepointChangedItems|GetOnChangedItems|${listParameters}"
    "OnSharepointNewItems|GetOnNewItems|${listParameters}"
    "OnSharepointUpdatedItems|GetOnUpdatedItems|${listParameters}"
    "OnSharepointNewFileItems|GetOnNewFileItems|${libraryParameters}"
    "OnSharepointUpdatedFileItems|GetOnUpdatedFileItems|${libraryParameters}"
)

if [[ "$sharepointEnableDeletionTriggers" == "true" ]]; then
    triggers+=("OnSharepointDeletedItems|GetOnDeletedItems|${listParameters}" "OnSharepointDeletedFileItems|GetOnDeletedFileItems|${libraryParameters}")
fi

if [[ "$sharepointEnableSyntexTrigger" == "true" ]]; then
    triggers+=("OnSharepointUpdatedFileClassifiedTimes|GetOnUpdatedFileClassifiedTimes|${libraryParameters}")
fi

if [[ -n "$sharepointFormId" ]]; then
    triggers+=("OnSharepointNewItemsFromForm|GetOnNewItemsFromForm|$(jq -nc --argjson p "$listParameters" --arg f "$sharepointFormId" '$p + [{name:"form",value:$f}]')")
fi

if [[ -n "$sharepointDigestSchedule" ]]; then
    triggers+=("OnSharepointRecurrenceDigest|GetOnRecurrenceDigest|$(jq -nc --argjson p "$libraryParameters" --arg s "$sharepointDigestSchedule" '$p + [{name:"add",value:true},{name:"update",value:true},{name:"runSchedule",value:$s}]')")
fi

existingTriggers=$(az connector-namespace trigger list -g "$resourceGroupName" --namespace "$connectorNamespaceName" --query '[].name' -o json)
optionalFunctions=(OnSharepointDeletedItems OnSharepointDeletedFileItems OnSharepointUpdatedFileClassifiedTimes OnSharepointNewItemsFromForm OnSharepointRecurrenceDigest)
for functionName in "${optionalFunctions[@]}"; do
    selected=false
    for entry in "${triggers[@]}"; do
        if [[ "$entry" == "$functionName|"* ]]; then selected=true; break; fi
    done
    triggerName="${sharepointConnectionName}-$(echo "$functionName" | tr '[:upper:]' '[:lower:]')"
    if [[ "$selected" == "false" ]] && jq -e --arg n "$triggerName" 'index($n) != null' <<< "$existingTriggers" >/dev/null; then
        echo "Disabling opt-in trigger: $functionName"
        az connector-namespace trigger update -g "$resourceGroupName" --namespace "$connectorNamespaceName" -n "$triggerName" --state Disabled -o none
    fi
done

triggerFailures=()
for entry in "${triggers[@]}"; do
    IFS='|' read -r functionName operationName parameters <<< "$entry"

    triggerName="${sharepointConnectionName}-$(echo "$functionName" | tr '[:upper:]' '[:lower:]')"
    callbackUrl="https://${functionAppName}.azurewebsites.net/runtime/webhooks/connector?functionName=${functionName}"
    notificationDetails=$(jq -nc --arg url "${callbackUrl}" --arg key "${connectorExtensionKey}" '{callbackUrl:$url, httpMethod:"Post", authentication:{type:"QueryString", name:"code", value:$key}}')

    echo ""
    echo -e "${YELLOW}Creating trigger '${triggerName}' for ${functionName} (${operationName})...${NC}"

    verb=create
    if jq -e --arg n "$triggerName" 'index($n) != null' <<< "$existingTriggers" >/dev/null; then verb=update; fi

    if ! az connector-namespace trigger "$verb" \
        -g "${resourceGroupName}" \
        --namespace "${connectorNamespaceName}" \
        -n "${triggerName}" \
        --connection-details "${connectionDetails}" \
        --operation-name "${operationName}" \
        --parameters "${parameters}" \
        --notification-details "${notificationDetails}" \
        --state "Enabled" \
        --description "SharePoint ${operationName} -> ${functionName}"; then
        echo -e "${YELLOW}WARNING: Failed to create trigger '${triggerName}'. Continuing.${NC}"
        triggerFailures+=("${triggerName}")
    fi
done

echo ""
if [[ ${#triggerFailures[@]} -eq 0 ]]; then
    echo -e "${GREEN}✅ Connector Namespace trigger configs created successfully.${NC}"
else
    echo -e "${YELLOW}⚠  Some trigger configs failed: ${triggerFailures[*]}${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Post-deployment configuration complete.${NC}"
echo ""
