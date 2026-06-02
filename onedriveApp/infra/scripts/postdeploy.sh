#!/bin/bash
# Post-deployment configuration for the onedriveApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Create one Connector Namespace trigger config per Functions trigger
#      in this app, each POSTing to the function's connector webhook URL.
#   2. Walk the operator through OAuth consent for the OneDrive for Business
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
onedriveConnectionName=$(echo "$outputs" | jq -r '.onedriveConnectionName')
functionAppName=$(echo "$outputs" | jq -r '.functionAppName')

if [[ -z "$resourceGroupName" || -z "$connectorNamespaceName" || -z "$onedriveConnectionName" || -z "$functionAppName" ]]; then
    echo -e "${RED}ERROR: required azd outputs missing. Run 'azd provision' first.${NC}"
    exit 1
fi

# --- Required OneDrive identifiers ------------------------------------------
onedriveFolderId=$(echo "$outputs" | jq -r '.ONEDRIVE_FOLDER_ID // empty')

graph_get() {
    local errFile
    errFile=$(mktemp)
    local out rc
    # Quote the URL so '&' / '$' survive shell re-parsing.
    out=$(az rest --method get --url "$1" --resource https://graph.microsoft.com 2>"$errFile")
    rc=$?
    if [[ $rc -ne 0 || -z "$out" ]]; then
        if [[ -s "$errFile" ]]; then
            echo "   Graph call failed: $(cat "$errFile")" >&2
        fi
        rm -f "$errFile"
        return 1
    fi
    rm -f "$errFile"
    echo "$out"
}

select_from_list() {
    # Args: title, then alternating "label|sublabel" entries (sublabel optional).
    local title="$1"; shift
    local entries=("$@")
    echo "" >&2
    echo -e "${YELLOW}${title}${NC}" >&2
    local i=1
    for e in "${entries[@]}"; do
        local lbl="${e%%|*}"
        local sub=""
        if [[ "$e" == *"|"* ]]; then sub="${e#*|}"; fi
        if [[ -n "$sub" ]]; then
            echo "  [$i] $lbl  ($sub)" >&2
        else
            echo "  [$i] $lbl" >&2
        fi
        i=$((i+1))
    done
    while true; do
        read -r -p "Enter number (1-${#entries[@]}): " answer
        if [[ "$answer" =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= ${#entries[@]} )); then
            echo $((answer-1))
            return
        fi
        echo -e "${YELLOW}Invalid selection.${NC}" >&2
    done
}

echo ""
if [[ -n "$onedriveFolderId" ]]; then
    echo -e "Current ONEDRIVE_FOLDER_ID: $onedriveFolderId"
fi

# Folder selection happens AFTER OAuth consent — see Phase 2 near the end of
# this script. The connection itself does not need a folder id; only the
# triggers do, so we authorize first and pick the folder afterwards.

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

# --- Authorize the OneDrive connection (OAuth consent) ---------------------
echo ""
echo -e "${YELLOW}Authorizing OneDrive for Business connection via Azure CLI...${NC}"

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

create_onedrive_connection() {
    local connectionName="$1"
    echo -e "${YELLOW}-> Creating OneDrive connection '${connectionName}' on namespace '${connectorNamespaceName}'...${NC}"
    if ! az connector-namespace connection create \
        -g "${resourceGroupName}" \
        --namespace "${connectorNamespaceName}" \
        -n "${connectionName}" \
        --connector-name 'onedrive'; then
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
        if ! create_onedrive_connection "${connectionName}"; then
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

if ! authorize_connection "${onedriveConnectionName}" "OneDrive for Business"; then
    echo ""
    echo -e "${RED}ERROR: OneDrive connection is not Connected. Cannot create triggers.${NC}"
    echo -e "${RED}       Complete the OAuth consent flow, then re-run: azd hooks run postdeploy${NC}"
    exit 1
fi

# --- Phase 2: select OneDrive folder + create triggers ----------------------
# Connection is now authorized. Pick the folder Id for trigger 'folderId'.
# We list folders by forwarding requests THROUGH the authorized connection
# ('az connector-namespace connection invoke'), so this works even when the
# Azure CLI's own Graph token lacks Files.Read consent in the tenant.
echo ""
echo -e "${YELLOW}Listing OneDrive folders via the authorized connection...${NC}"

# urlencode <string>
urlencode() {
    local LANG=C s="$1" out="" i c
    for (( i=0; i<${#s}; i++ )); do
        c="${s:i:1}"
        case "$c" in
            [a-zA-Z0-9.~_-]) out+="$c" ;;
            *) out+=$(printf '%%%02X' "'$c") ;;
        esac
    done
    printf '%s' "$out"
}

# Invoke an arbitrary HTTP request through the authorized connection. Echoes
# the JSON response body to stdout, or empty on failure. The CLI extension's
# 200-handler chokes on array bodies, so we run with --debug and grep the
# {"response":{"statusCode":..,"body":..,"headers":..}} envelope from the log.
connection_invoke() {
    local path="$1" method="${2:-get}"
    local reqFile
    reqFile=$(mktemp --suffix=.json)
    jq -nc --arg m "$method" --arg p "$path" '{method:$m, path:$p}' > "$reqFile"
    local raw
    raw=$(az connector-namespace connection invoke \
        -g "${resourceGroupName}" \
        --namespace "${connectorNamespaceName}" \
        --connection-name "${onedriveConnectionName}" \
        --request "@$reqFile" --debug 2>&1 || true)
    rm -f "$reqFile"
    # Extract the first occurrence of {"response":...} JSON object.
    local envelope
    envelope=$(echo "$raw" | grep -oE '\{"response":\{.*\}\}' | head -n1)
    [[ -z "$envelope" ]] && return 1
    local sc
    sc=$(echo "$envelope" | jq -r '.response.statusCode // empty')
    case "$sc" in
        OK|Created|Accepted|NoContent) echo "$envelope" | jq -c '.response.body'; return 0 ;;
        *) echo "   connection invoke returned status: $sc" >&2; return 1 ;;
    esac
}

select_onedrive_folder() {
    local savedId="$1"
    local -a stackIds stackPaths
    stackIds=("root"); stackPaths=("/")

    while true; do
        local top=$((${#stackIds[@]} - 1))
        local curId="${stackIds[$top]}"
        local curPath="${stackPaths[$top]}"

        echo "" >&2
        echo -e "${CYAN}Current folder: ${curPath}  [id: ${curId}]${NC}" >&2

        local listingPath
        if [[ "$curId" == "root" ]]; then
            listingPath='/datasets/default/folders'
        else
            listingPath="/datasets/default/folders/$(urlencode "$curId")"
        fi
        local body
        body=$(connection_invoke "$listingPath" 'get' || true)

        local -a entries actions targetIds targetPaths
        entries+=("[OK] Use this folder (${curPath})"); actions+=("pick"); targetIds+=("$curId"); targetPaths+=("")
        if [[ -n "$savedId" && $top -eq 0 ]]; then
            entries+=("(keep current saved: $savedId)"); actions+=("keep"); targetIds+=("$savedId"); targetPaths+=("")
        fi
        if [[ $top -gt 0 ]]; then
            entries+=(".. (go up)"); actions+=("up"); targetIds+=(""); targetPaths+=("")
        fi
        if [[ -n "$body" && "$body" != "null" ]]; then
            while IFS=$'\t' read -r cName cId; do
                [[ -z "$cId" ]] && continue
                entries+=("-> ${cName}")
                actions+=("down"); targetIds+=("$cId")
                if [[ "$curPath" == "/" ]]; then
                    targetPaths+=("/${cName}")
                else
                    targetPaths+=("${curPath}/${cName}")
                fi
            done < <(echo "$body" | jq -r '.[] | select(.IsFolder == true) | [.Name, .Id] | @tsv' 2>/dev/null)
        fi
        entries+=("(Enter folder id manually...)"); actions+=("manual"); targetIds+=(""); targetPaths+=("")
        entries+=("(Cancel — skip trigger creation)"); actions+=("cancel"); targetIds+=(""); targetPaths+=("")

        local idx
        idx=$(select_from_list 'Choose an action:' "${entries[@]}")
        case "${actions[$idx]}" in
            pick|keep) printf '%s' "${targetIds[$idx]}"; return 0 ;;
            up) unset 'stackIds[-1]' 'stackPaths[-1]' ;;
            down)
                stackIds+=("${targetIds[$idx]}")
                stackPaths+=("${targetPaths[$idx]}")
                ;;
            manual)
                local manual
                read -r -p 'OneDrive folder id: ' manual
                if [[ -n "$manual" ]]; then printf '%s' "$manual"; return 0; fi
                ;;
            cancel) return 1 ;;
        esac
    done
}

if selected=$(select_onedrive_folder "$onedriveFolderId"); then
    onedriveFolderId="$selected"
else
    echo -e "${YELLOW}Skipping trigger creation.${NC}"
    echo -e "${GREEN}✅ Connection authorized; triggers pending.${NC}"
    exit 0
fi

azd env set ONEDRIVE_FOLDER_ID "$onedriveFolderId" >/dev/null
echo -e "${GREEN}Saved ONEDRIVE_FOLDER_ID=$onedriveFolderId${NC}"

# --- Create Connector Namespace trigger configs -----------------------------
echo ""
echo -e "${CYAN}Fetching connector extension key for ${functionAppName}...${NC}"
connectorExtensionKey=$(az functionapp keys list -g "${resourceGroupName}" -n "${functionAppName}" --query "systemKeys.connector_extension" -o tsv)
if [[ -z "$connectorExtensionKey" ]]; then
    echo -e "${RED}ERROR: could not fetch connector_extension system key from ${functionAppName}.${NC}"
    exit 1
fi

connectionDetails=$(jq -nc --arg conn "${onedriveConnectionName}" \
    '{connectorName:"onedrive", connectionName:$conn}')

# functionName | operationName | parameters JSON
triggers=(
    "OnOneDriveNewFile|OnNewFileV2|$(jq -nc --arg f "$onedriveFolderId" '[{name:"folderId",value:$f}]')"
    "OnOneDriveUpdatedFile|OnUpdatedFileV2|$(jq -nc --arg f "$onedriveFolderId" '[{name:"folderId",value:$f}]')"
)

triggerFailures=()
for entry in "${triggers[@]}"; do
    IFS='|' read -r functionName operationName parameters <<< "$entry"

    triggerName="${onedriveConnectionName}-$(echo "$functionName" | tr '[:upper:]' '[:lower:]')"
    callbackUrl="https://${functionAppName}.azurewebsites.net/runtime/webhooks/connector?functionName=${functionName}&code=${connectorExtensionKey}"
    notificationDetails=$(jq -nc --arg url "${callbackUrl}" '{callbackUrl:$url, httpMethod:"Post"}')

    echo ""
    echo -e "${YELLOW}Creating trigger '${triggerName}' for ${functionName} (${operationName})...${NC}"

    az connector-namespace trigger delete \
        -g "${resourceGroupName}" --namespace "${connectorNamespaceName}" \
        -n "${triggerName}" --yes 2>/dev/null || true

    if ! az connector-namespace trigger create \
        -g "${resourceGroupName}" \
        --namespace "${connectorNamespaceName}" \
        -n "${triggerName}" \
        --connection-details "${connectionDetails}" \
        --operation-name "${operationName}" \
        --parameters "${parameters}" \
        --notification-details "${notificationDetails}" \
        --state "Enabled" \
        --description "OneDrive ${operationName} -> ${functionName}"; then
        echo -e "${YELLOW}WARNING: Failed to create trigger '${triggerName}'. Continuing.${NC}"
        triggerFailures+=("${triggerName}")
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
