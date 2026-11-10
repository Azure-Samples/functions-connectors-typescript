#!/bin/bash
# Post-deployment configuration for the azureblobApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Configure the Azure Blob connection with the namespace's managed identity.
#   2. Create one Connector Namespace trigger config per Functions trigger
#      targeting the provisioned test storage account and container.

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

resourceGroupName=$(echo "$outputs"        | jq -r '.resourceGroupName // empty')
connectorNamespaceName=$(echo "$outputs"   | jq -r '.connectorNamespaceName // empty')
azureblobConnectionName=$(echo "$outputs"  | jq -r '.azureblobConnectionName // empty')
functionAppName=$(echo "$outputs"          | jq -r '.functionAppName // empty')
namespaceLocation=$(echo "$outputs"        | jq -r '.CONNECTOR_NAMESPACE_LOCATION // empty')
namespacePrincipalId=$(echo "$outputs"     | jq -r '.connectorNamespacePrincipalId // empty')
accountInput=$(echo "$outputs"            | jq -r '.monitoredStorageAccountName // empty')
containerInput=$(echo "$outputs"          | jq -r '.monitoredContainerName // empty')
functionAppPrincipalId=$(echo "$outputs"   | jq -r '.functionAppPrincipalId // empty')
userPrincipalId=$(echo "$outputs"          | jq -r '.AZURE_PRINCIPAL_ID // empty')
tenantId=$(az account show --query tenantId -o tsv)

if [[ -z "$resourceGroupName" || -z "$connectorNamespaceName" || -z "$azureblobConnectionName" || -z "$functionAppName" ||
      -z "$namespaceLocation" || -z "$namespacePrincipalId" || -z "$accountInput" || -z "$containerInput" ]]; then
    echo -e "${RED}ERROR: required azd outputs missing. Run 'azd provision' first.${NC}"
    exit 1
fi

subscriptionId=$(az account show --query id -o tsv)

# --- Verify the connector-namespace az CLI extension is installed ----------
extInstalled="$(az extension show --name connector-namespace --query name -o tsv 2>/dev/null || true)"
if [[ -z "$extInstalled" ]]; then
    echo -e "${RED}ERROR: 'connector-namespace' Azure CLI extension is not installed.${NC}" >&2
    echo -e "${RED}       Download the latest 'connector_namespace-*.whl' from${NC}" >&2
    echo -e "${RED}       https://github.com/Azure/Connectors/releases and run:${NC}" >&2
    echo -e "${RED}         az extension add --source <wheel-url-or-path>${NC}" >&2
    echo -e "${RED}       Then re-run: azd hooks run postup${NC}" >&2
    exit 2
fi

set_connection_managed_identity_auth() {
    local url="https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Web/connectorGateways/${connectorNamespaceName}/connections/${azureblobConnectionName}?api-version=2026-05-01-preview"
    local bodyFile
    bodyFile=$(mktemp) || return 1
    jq -nc \
        --arg loc "$namespaceLocation" \
        '{
            location: $loc,
            properties: {
                connectorName: "azureblob",
                parameterValueSet: {
                    name: "managedIdentityAuth",
                    values: {}
                },
                connectionProperties: {
                    authentication: { type: "ManagedServiceIdentity" }
                }
            }
        }' > "$bodyFile"
    local rc=0
    az rest --method put --url "$url" --body "@$bodyFile" -o none || rc=$?
    rm -f "$bodyFile"
    return $rc
}

wait_connection_status() {
    local timeout="${1:-90}"
    local deadline=$(($(date +%s) + timeout))
    local lastStatus="" s sLower
    while [[ $(date +%s) -lt $deadline ]]; do
        s=$(az connector-namespace connection show \
            -g "$resourceGroupName" --namespace "$connectorNamespaceName" \
            -n "$azureblobConnectionName" --query "properties.overallStatus" -o tsv 2>/dev/null || echo "")
        if [[ "$s" != "$lastStatus" ]]; then
            echo -e "${CYAN}   status: ${s:-?}${NC}" >&2
            lastStatus="$s"
        fi
        sLower=$(echo "$s" | tr '[:upper:]' '[:lower:]')
        if [[ "$sLower" == "connected" ]]; then printf 'Connected'; return; fi
        if [[ "$sLower" == "ready" ]]; then printf 'Ready'; return; fi
        if [[ "$sLower" == "error" ]]; then printf 'Error'; return; fi
        sleep 3
    done
    printf '%s' "$lastStatus"
}

show_connection_error() {
    local url="https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Web/connectorGateways/${connectorNamespaceName}/connections/${azureblobConnectionName}?api-version=2026-05-01-preview"
    local raw
    raw=$(az rest --method get --url "$url" -o json 2>/dev/null || echo "")
    if [[ -z "$raw" ]]; then
        echo -e "${RED}   (failed to fetch connection resource for diagnostics)${NC}" >&2
        return
    fi
    local printed=0
    local err
    err=$(echo "$raw" | jq -r '.properties.error // empty | "   detail: \(.code // ""): \(.message // "")"' 2>/dev/null)
    if [[ -n "$err" ]]; then
        echo -e "${RED}${err}${NC}" >&2
        printed=1
    fi
    local stErrs
    stErrs=$(echo "$raw" | jq -r '.properties.statuses[]? | if .error then "   detail: \(.error.code // ""): \(.error.message // "")" elif .statusReason then "   detail: \(.statusReason)" elif (.status and .status != "Error") then "   detail: status=\(.status)" else empty end' 2>/dev/null)
    if [[ -n "$stErrs" ]]; then
        echo -e "${RED}${stErrs}${NC}" >&2
        printed=1
    fi
    if [[ $printed -eq 0 ]]; then
        echo -e "${YELLOW}   (connector did not return a structured error)${NC}" >&2
    fi
}

echo -e "${YELLOW}-> Configuring '${azureblobConnectionName}' with the namespace's system-assigned identity...${NC}"
if ! set_connection_managed_identity_auth; then
    echo -e "${RED}ERROR: failed to update Azure Blob connection (ARM PUT failed).${NC}"
    exit 1
fi

finalStatus=$(wait_connection_status 90)
if [[ "$finalStatus" != "Connected" && "$finalStatus" != "Ready" ]]; then
    echo -e "${RED}ERROR: managed identity connection status is '${finalStatus}'.${NC}"
    show_connection_error
    echo -e "${YELLOW}Verify the namespace identity and retry: azd hooks run postup${NC}"
    exit 1
fi

# --- Create connection access policies --------------------------------------
set_connection_access_policy() {
    local policyName="$1" objectId="$2"
    local url="https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Web/connectorGateways/${connectorNamespaceName}/connections/${azureblobConnectionName}/accessPolicies/${policyName}?api-version=2026-05-01-preview"
    local bodyFile
    bodyFile=$(mktemp) || return 1
    jq -nc --arg oid "$objectId" --arg tid "$tenantId" '{
        properties: { principal: { type: "ActiveDirectory", identity: { objectId: $oid, tenantId: $tid } } }
    }' > "$bodyFile"
    local rc=0
    az rest --method put --url "$url" --body "@$bodyFile" -o none || rc=$?
    rm -f "$bodyFile"
    return $rc
}

set_connection_access_policy 'namespace-msi' "$namespacePrincipalId"
if [[ -n "$functionAppPrincipalId" ]]; then
    echo -e "${CYAN}-> Granting function-app managed identity access to the connection...${NC}"
    set_connection_access_policy 'functionapp-msi' "$functionAppPrincipalId"
fi
if [[ -n "$userPrincipalId" ]]; then
    echo -e "${CYAN}-> Granting deployer user access to the connection...${NC}"
    set_connection_access_policy 'dev-user' "$userPrincipalId"
fi

# --- Wire AzureBlobConnection app setting -----------------------------------
connRuntimeUrl=$(az rest --method get \
    --url "https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Web/connectorGateways/${connectorNamespaceName}/connections/${azureblobConnectionName}?api-version=2026-05-01-preview" \
    --query "properties.connectionRuntimeUrl" -o tsv 2>/dev/null || echo "")
if [[ -n "$connRuntimeUrl" ]]; then
    echo -e "${CYAN}-> Setting AzureBlobConnection app setting on ${functionAppName}...${NC}"
    az functionapp config appsettings set -g "$resourceGroupName" -n "$functionAppName" --settings "AzureBlobConnection=$connRuntimeUrl" -o none
else
    echo -e "${RED}ERROR: could not fetch connection runtime URL.${NC}"
    exit 1
fi

# --- Compute folderId for the trigger --------------------------------------
# The azureblob connector encodes the container path as base64 of the
# url-encoded virtual path: '/<container>' -> '%2F<container>' -> base64.
folderId=$(printf '%%2F%s' "$containerInput" | base64 -w0 2>/dev/null || printf '%%2F%s' "$containerInput" | base64 | tr -d '\n')

echo ""
echo -e "Container '$containerInput' -> folderId '$folderId'"

# --- Create Connector Namespace trigger configs -----------------------------
echo ""
echo -e "${CYAN}Fetching connector extension key for ${functionAppName}...${NC}"
connectorExtensionKey=$(az functionapp keys list -g "$resourceGroupName" -n "$functionAppName" --query "systemKeys.connector_extension" -o tsv)
if [[ -z "$connectorExtensionKey" ]]; then
    echo -e "${RED}ERROR: could not fetch connector_extension system key from ${functionAppName}.${NC}"
    exit 1
fi

connectionDetails=$(jq -nc --arg conn "$azureblobConnectionName" \
    '{connectorName:"azureblob", connectionName:$conn}')

# functionName | operationName | parameters JSON
triggers=(
    "OnAzureBlobUpdatedFile|OnUpdatedFiles_V2|$(jq -nc --arg d "$accountInput" --arg f "$folderId" '[{name:"dataset",value:$d},{name:"folderId",value:$f}]')"
)

triggerFailures=()
for entry in "${triggers[@]}"; do
    IFS='|' read -r functionName operationName parameters <<< "$entry"

    triggerName="${azureblobConnectionName}-$(echo "$functionName" | tr '[:upper:]' '[:lower:]')"
    callbackUrl="https://${functionAppName}.azurewebsites.net/runtime/webhooks/connector?functionName=${functionName}"
    notificationDetails=$(jq -nc --arg url "$callbackUrl" --arg key "$connectorExtensionKey" '{callbackUrl:$url, httpMethod:"Post", authentication:{type:"QueryString", name:"code", value:$key}}')

    echo ""
    echo -e "${YELLOW}Creating trigger '${triggerName}' for ${functionName} (${operationName})...${NC}"

    az connector-namespace trigger delete \
        -g "$resourceGroupName" --namespace "$connectorNamespaceName" \
        -n "$triggerName" --yes 2>/dev/null || true

    if ! az connector-namespace trigger create \
        -g "$resourceGroupName" \
        --namespace "$connectorNamespaceName" \
        -n "$triggerName" \
        --connection-details "$connectionDetails" \
        --operation-name "$operationName" \
        --parameters "$parameters" \
        --notification-details "$notificationDetails" \
        --state "Enabled" \
        --description "Azure Blob ${operationName} -> ${functionName}" \
        -o none; then
        echo -e "${YELLOW}WARNING: Failed to create trigger '${triggerName}'.${NC}"
        triggerFailures+=("$triggerName")
    fi
done

echo ""
if [[ ${#triggerFailures[@]} -eq 0 ]]; then
    echo -e "${GREEN}✅ Connector Namespace trigger configs created successfully.${NC}"
else
    echo -e "${RED}ERROR: Some trigger configs failed: ${triggerFailures[*]}${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Post-deployment configuration complete.${NC}"
echo "Upload blobs to '$containerInput' in storage account '$accountInput' to test the trigger."
echo ""
