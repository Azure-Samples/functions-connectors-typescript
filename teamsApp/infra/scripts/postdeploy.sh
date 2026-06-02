#!/bin/bash
# Post-deployment configuration for the teamsApp.
#
# Uses the official `connector-namespace` Azure CLI extension from
# https://github.com/Azure/Connectors. Two responsibilities:
#   1. Create one Connector Namespace trigger config per Functions trigger
#      in this app, each POSTing to the function's connector webhook URL.
#   2. Walk the operator through OAuth consent for the Microsoft Teams
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
teamsConnectionName=$(echo "$outputs" | jq -r '.teamsConnectionName')
functionAppName=$(echo "$outputs" | jq -r '.functionAppName')

if [[ -z "$resourceGroupName" || -z "$connectorNamespaceName" || -z "$teamsConnectionName" || -z "$functionAppName" ]]; then
    echo -e "${RED}ERROR: required azd outputs missing. Run 'azd provision' first.${NC}"
    exit 1
fi

# --- Required Teams identifiers --------------------------------------------
teamsGroupId=$(echo "$outputs" | jq -r '.TEAMS_GROUP_ID // empty')
teamsChannelId=$(echo "$outputs" | jq -r '.TEAMS_CHANNEL_ID // empty')

graph_get() {
    az rest --method get --url "$1" --resource https://graph.microsoft.com 2>/dev/null
}

select_from_list() {
    local title="$1"; shift
    local labels=("$@")
    echo ""
    echo -e "${YELLOW}${title}${NC}" >&2
    local i=1
    for l in "${labels[@]}"; do
        echo "  [$i] $l" >&2
        i=$((i+1))
    done
    while true; do
        read -r -p "Enter number (1-${#labels[@]}): " answer
        if [[ "$answer" =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= ${#labels[@]} )); then
            echo $((answer-1))
            return
        fi
        echo -e "${YELLOW}Invalid selection.${NC}" >&2
    done
}

if [[ -z "$teamsGroupId" || -z "$teamsChannelId" ]]; then
    echo ""
    echo -e "${YELLOW}TEAMS_GROUP_ID / TEAMS_CHANNEL_ID not set. Fetching your Teams from Microsoft Graph...${NC}"

    teamsJson=$(graph_get 'https://graph.microsoft.com/v1.0/me/joinedTeams?$select=id,displayName' || true)
    teamsCount=$(echo "$teamsJson" | jq -r '.value | length // 0')
    if [[ -z "$teamsJson" || "$teamsCount" == "0" ]]; then
        echo -e "${RED}ERROR: Could not list your joined teams via Microsoft Graph.${NC}" >&2
        echo -e "${RED}       Ensure 'az login' was run with a user account that is a member of at least one team,${NC}" >&2
        echo -e "${RED}       or set the values manually:${NC}" >&2
        echo -e "${RED}         azd env set TEAMS_GROUP_ID   <team / Microsoft 365 group object id>${NC}" >&2
        echo -e "${RED}         azd env set TEAMS_CHANNEL_ID <channel id, e.g. 19:abcd...@thread.tacv2>${NC}" >&2
        exit 1
    fi

    if [[ -z "$teamsGroupId" ]]; then
        mapfile -t teamLabels < <(echo "$teamsJson" | jq -r '.value[].displayName')
        mapfile -t teamIds    < <(echo "$teamsJson" | jq -r '.value[].id')
        idx=$(select_from_list 'Select a team:' "${teamLabels[@]}")
        teamsGroupId="${teamIds[$idx]}"
        azd env set TEAMS_GROUP_ID "$teamsGroupId" >/dev/null
        echo -e "${GREEN}Saved TEAMS_GROUP_ID=$teamsGroupId${NC}"
    fi

    if [[ -z "$teamsChannelId" ]]; then
        channelsJson=$(graph_get "https://graph.microsoft.com/v1.0/teams/$teamsGroupId/channels?\$select=id,displayName" || true)
        channelsCount=$(echo "$channelsJson" | jq -r '.value | length // 0')
        if [[ -z "$channelsJson" || "$channelsCount" == "0" ]]; then
            echo -e "${RED}ERROR: Could not list channels for team $teamsGroupId.${NC}" >&2
            exit 1
        fi
        mapfile -t chanLabels < <(echo "$channelsJson" | jq -r '.value[].displayName')
        mapfile -t chanIds    < <(echo "$channelsJson" | jq -r '.value[].id')
        idx=$(select_from_list 'Select a channel:' "${chanLabels[@]}")
        teamsChannelId="${chanIds[$idx]}"
        azd env set TEAMS_CHANNEL_ID "$teamsChannelId" >/dev/null
        echo -e "${GREEN}Saved TEAMS_CHANNEL_ID=$teamsChannelId${NC}"
    fi
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

# --- Authorize the Teams connection (OAuth consent) -------------------------
echo ""
echo -e "${YELLOW}Authorizing Microsoft Teams connection via Azure CLI...${NC}"

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

create_teams_connection() {
    local connectionName="$1"
    echo -e "${YELLOW}-> Creating Teams connection '${connectionName}' on namespace '${connectorNamespaceName}'...${NC}"
    if ! az connector-namespace connection create \
        -g "${resourceGroupName}" \
        --namespace "${connectorNamespaceName}" \
        -n "${connectionName}" \
        --connector-name 'teams'; then
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
        if ! create_teams_connection "${connectionName}"; then
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

if ! authorize_connection "${teamsConnectionName}" "Microsoft Teams"; then
    echo ""
    echo -e "${RED}ERROR: Microsoft Teams connection is not Connected. Cannot create triggers.${NC}"
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

connectionDetails=$(jq -nc --arg conn "${teamsConnectionName}" \
    '{connectorName:"teams", connectionName:$conn}')

# functionName | operationName | parameters JSON
triggers=(
    "OnNewChannelMessage|OnNewChannelMessage|$(jq -nc --arg g "$teamsGroupId" --arg c "$teamsChannelId" '[{name:"groupId",value:$g},{name:"channelId",value:$c}]')"
    "OnNewChannelMessageMentioningMe|OnNewChannelMessageMentioningMe|$(jq -nc --arg g "$teamsGroupId" --arg c "$teamsChannelId" '[{name:"groupId",value:$g},{name:"channelId",value:$c}]')"
    "OnGroupMembershipAdd|OnGroupMembershipAdd|$(jq -nc --arg g "$teamsGroupId" '[{name:"groupId",value:$g}]')"
    "OnGroupMembershipRemoval|OnGroupMembershipRemoval|$(jq -nc --arg g "$teamsGroupId" '[{name:"groupId",value:$g}]')"
)

triggerFailures=()
for entry in "${triggers[@]}"; do
    IFS='|' read -r functionName operationName parameters <<< "$entry"

    triggerName="${teamsConnectionName}-$(echo "$functionName" | tr '[:upper:]' '[:lower:]')"
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
        --description "Teams ${operationName} -> ${functionName}"; then
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
