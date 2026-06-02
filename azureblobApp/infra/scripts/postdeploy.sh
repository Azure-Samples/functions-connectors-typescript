#!/bin/bash
# Post-deployment configuration for the azureblobApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Configure the Azure Blob connection with the user's storage account
#      name (or blob endpoint) and access key.
#   2. Create one Connector Namespace trigger config per Functions trigger
#      with the selected container as the trigger's `folderId`.

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

resourceGroupName=$(echo "$outputs"        | jq -r '.resourceGroupName')
connectorNamespaceName=$(echo "$outputs"   | jq -r '.connectorNamespaceName')
azureblobConnectionName=$(echo "$outputs"  | jq -r '.azureblobConnectionName')
functionAppName=$(echo "$outputs"          | jq -r '.functionAppName')
azureLocation=$(echo "$outputs"            | jq -r '.AZURE_LOCATION')

if [[ -z "$resourceGroupName" || -z "$connectorNamespaceName" || -z "$azureblobConnectionName" || -z "$functionAppName" ]]; then
    echo -e "${RED}ERROR: required azd outputs missing. Run 'azd provision' first.${NC}"
    exit 1
fi

subscriptionId=$(az account show --query id -o tsv)

savedAccount=$(echo "$outputs"   | jq -r '.BLOB_ACCOUNT // empty')
savedContainer=$(echo "$outputs" | jq -r '.BLOB_CONTAINER // empty')

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

# --- Prompt for connection inputs ------------------------------------------
echo ""
echo -e "${CYAN}Configure the Azure Blob connection.${NC}"
echo -e "  Reference: https://learn.microsoft.com/en-us/connectors/azureblob/"
echo ""

if [[ ! -t 0 ]]; then
    echo -e "${RED}ERROR: postdeploy needs an interactive terminal to prompt for storage account / access key / container.${NC}"
    echo -e "${RED}       Re-run interactively:  azd hooks run postdeploy${NC}"
    exit 1
fi

validate_account_input() {
    # echo back the value if accepted (or after y/N override), empty if rejected.
    local v="$1"
    if [[ "$v" =~ ^https?:// ]]; then
        if [[ "$v" != *".blob.core.windows.net"* ]]; then
            echo -e "${YELLOW}WARNING: blob endpoint URL does not contain '.blob.core.windows.net' — typo? Got: $v${NC}" >&2
            local ok=""
            read -r -p "Use it anyway? [y/N]: " ok
            [[ "$ok" =~ ^[Yy] ]] || { printf ''; return; }
        fi
    elif ! [[ "$v" =~ ^[a-z0-9]{3,24}$ ]]; then
        echo -e "${YELLOW}WARNING: '$v' does not look like a valid storage account name (3-24 lowercase alphanumeric).${NC}" >&2
        local ok=""
        read -r -p "Use it anyway? [y/N]: " ok
        [[ "$ok" =~ ^[Yy] ]] || { printf ''; return; }
    fi
    printf '%s' "$v"
}

read_account_input() {
    local saved="$1"
    while true; do
        local val
        if [[ -n "$saved" ]]; then
            read -r -p "Storage account name OR blob endpoint URL [$saved]: " val
            val="${val:-$saved}"
        else
            read -r -p "Storage account name OR blob endpoint URL (e.g. 'mystorage' or 'https://mystorage.blob.core.windows.net/'): " val
        fi
        [[ -z "$val" ]] && { echo -e "${YELLOW}Required.${NC}" >&2; continue; }
        local v
        v=$(validate_account_input "$val")
        if [[ -n "$v" ]]; then printf '%s' "$v"; return; fi
    done
}

read_access_key() {
    while true; do
        local key=""
        read -r -s -p "Storage account access key: " key
        echo "" >&2
        if [[ -n "$key" ]]; then printf '%s' "$key"; return; fi
        echo -e "${YELLOW}Required.${NC}" >&2
    done
}

read_container_name() {
    local saved="$1"
    while true; do
        local val
        if [[ -n "$saved" ]]; then
            read -r -p "Container name to watch [$saved]: " val
            val="${val:-$saved}"
        else
            read -r -p "Container name to watch (e.g. 'samples'): " val
        fi
        if [[ -n "$val" ]]; then printf '%s' "$val"; return; fi
        echo -e "${YELLOW}Required.${NC}" >&2
    done
}

set_connection_keybased_auth() {
    local acct="$1" key="$2"
    local url="https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Web/connectorGateways/${connectorNamespaceName}/connections/${azureblobConnectionName}?api-version=2026-05-01-preview"
    local bodyFile
    bodyFile=$(mktemp --suffix=.json)
    jq -nc \
        --arg loc "$azureLocation" \
        --arg acct "$acct" \
        --arg key "$key" \
        '{
            location: $loc,
            properties: {
                connectorName: "azureblob",
                parameterValueSet: {
                    name: "keyBasedAuth",
                    values: {
                        accountName: { value: $acct },
                        accessKey:   { value: $key }
                    }
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
        if [[ "$sLower" == "error" ]]; then printf 'Error'; return; fi
        sleep 3
    done
    printf '%s' "$lastStatus"
}

show_connection_error() {
    local detail
    detail=$(az connector-namespace connection show \
        -g "$resourceGroupName" --namespace "$connectorNamespaceName" \
        -n "$azureblobConnectionName" --query "properties.statuses" -o json 2>/dev/null || echo "")
    if [[ -n "$detail" && "$detail" != "null" ]]; then
        echo "$detail" | jq -r '.[]? | if .error then "   detail: \(.error.code // ""): \(.error.message // "")" else "   detail: status=\(.status // "")" end' >&2
    fi
}

accountInput=""
accessKey=""
containerInput=""
maxAttempts=3
for attempt in $(seq 1 $maxAttempts); do
    accountInput=$(read_account_input "$savedAccount")
    accessKey=$(read_access_key)
    if [[ $attempt -eq 1 ]]; then
        containerInput=$(read_container_name "$savedContainer")
    fi

    echo ""
    echo -e "${YELLOW}-> Updating connection '${azureblobConnectionName}' with key-based auth (attempt ${attempt}/${maxAttempts})...${NC}"
    if ! set_connection_keybased_auth "$accountInput" "$accessKey"; then
        echo -e "${RED}ERROR: failed to update Azure Blob connection (ARM PUT failed).${NC}"
        exit 1
    fi

    finalStatus=$(wait_connection_status 90)
    if [[ "$finalStatus" == "Connected" ]]; then
        echo -e "${GREEN}   Azure Blob connection is Connected.${NC}"
        break
    fi

    echo -e "${RED}ERROR: connection status is '${finalStatus}' — credentials or endpoint rejected.${NC}"
    show_connection_error
    if [[ $attempt -lt $maxAttempts ]]; then
        echo ""
        echo -e "${YELLOW}Re-enter the storage account / endpoint / access key and try again.${NC}"
        savedAccount="$accountInput"
    else
        echo ""
        echo -e "${RED}Giving up after ${maxAttempts} attempts. Verify the storage account name, blob endpoint, and access key, then re-run: azd hooks run postdeploy${NC}"
        exit 1
    fi
done

# Persist non-secret values for next run (only after Connected).
azd env set BLOB_ACCOUNT   "$accountInput"   >/dev/null
azd env set BLOB_CONTAINER "$containerInput" >/dev/null

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
    callbackUrl="https://${functionAppName}.azurewebsites.net/runtime/webhooks/connector?functionName=${functionName}&code=${connectorExtensionKey}"
    notificationDetails=$(jq -nc --arg url "$callbackUrl" '{callbackUrl:$url, httpMethod:"Post"}')

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
        --description "Azure Blob ${operationName} -> ${functionName}"; then
        echo -e "${YELLOW}WARNING: Failed to create trigger '${triggerName}'.${NC}"
        triggerFailures+=("$triggerName")
    fi
done

echo ""
if [[ ${#triggerFailures[@]} -eq 0 ]]; then
    echo -e "${GREEN}✅ Connector Namespace trigger configs created successfully.${NC}"
else
    echo -e "${YELLOW}⚠  Some trigger configs failed: ${triggerFailures[*]}${NC}"
fi

echo ""
echo -e "${GREEN}✅ Post-deployment configuration complete.${NC}"
echo ""
