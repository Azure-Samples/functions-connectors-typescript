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
sharepointSiteAddress=$(echo "$outputs" | jq -r '.SHAREPOINT_SITE_ADDRESS // empty')
sharepointFolderId=$(echo "$outputs"    | jq -r '.SHAREPOINT_FOLDER_ID // empty')

LAST_GRAPH_ERROR=""

graph_get() {
    local errFile
    errFile=$(mktemp)
    local out rc
    # Quote the URL so '&' / '$' survive shell re-parsing.
    out=$(az rest --method get --url "$1" --resource https://graph.microsoft.com 2>"$errFile")
    rc=$?
    if [[ $rc -ne 0 || -z "$out" ]]; then
        if [[ -s "$errFile" ]]; then
            LAST_GRAPH_ERROR="$(cat "$errFile")"
            echo "   Graph call failed: $LAST_GRAPH_ERROR" >&2
        else
            LAST_GRAPH_ERROR=""
        fi
        rm -f "$errFile"
        return 1
    fi
    LAST_GRAPH_ERROR=""
    rm -f "$errFile"
    echo "$out"
}

is_graph_forbidden() {
    [[ "$1" =~ [Ff]orbidden|accessDenied|InvalidAuthenticationToken|AuthenticationError|\"401\"|\"403\" ]]
}

az_login_for_graph() {
    echo "" >&2
    echo -e "${YELLOW}Re-authenticating Azure CLI with Microsoft Graph 'Sites.Read.All' scope...${NC}" >&2
    echo "  Running: az login --scope https://graph.microsoft.com/Sites.Read.All" >&2
    az login --scope https://graph.microsoft.com/Sites.Read.All --only-show-errors >/dev/null
    return $?
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

if [[ -z "$sharepointSiteAddress" || -z "$sharepointFolderId" ]]; then
    echo ""
    echo -e "${YELLOW}Fetching SharePoint sites accessible to your account from Microsoft Graph...${NC}"

    sitesJson=$(graph_get 'https://graph.microsoft.com/v1.0/sites?search=*&$select=id,displayName,webUrl&$top=100' || true)
    sitesCount=$(echo "$sitesJson" | jq -r '[.value[] | select(.displayName != null and .displayName != "")] | length // 0' 2>/dev/null || echo 0)

    # NOTE: We deliberately do NOT attempt 'az login --scope https://graph.microsoft.com/Sites.Read.All'.
    # Many tenants block that flow with AADSTS65002 (the Azure CLI first-party app is not
    # pre-authorized for Microsoft Graph). Fall back to manual site URL entry instead and let
    # the library/folder pickers run via Graph against that specific site.

    if [[ -z "$sitesJson" || "$sitesCount" == "0" ]]; then
        echo ""
        echo -e "${YELLOW}NOTE: The Azure CLI access token cannot enumerate SharePoint sites via Microsoft Graph search.${NC}" >&2
        echo -e "      (This is expected when the tenant has not pre-authorized the Azure CLI for 'Sites.Read.All'.)" >&2
        echo -e "${YELLOW}      You can paste the site URL directly; the library and folder pickers will still run.${NC}" >&2
        echo ""
        read -r -p "SharePoint site URL (e.g. https://contoso.sharepoint.com/sites/MySite): " sharepointSiteAddress
        if [[ -z "$sharepointSiteAddress" ]]; then
            echo -e "${RED}ERROR: No site provided. Set the values manually:${NC}" >&2
            echo -e "${RED}         azd env set SHAREPOINT_SITE_ADDRESS https://contoso.sharepoint.com/sites/MySite${NC}" >&2
            echo -e "${RED}         azd env set SHAREPOINT_FOLDER_ID    '/Shared Documents'${NC}" >&2
            exit 1
        fi
        azd env set SHAREPOINT_SITE_ADDRESS "$sharepointSiteAddress" >/dev/null
        echo -e "${GREEN}Saved SHAREPOINT_SITE_ADDRESS=$sharepointSiteAddress${NC}"
        sitesJson=""
    fi

    if [[ -n "$sitesJson" ]]; then
        mapfile -t siteIds   < <(echo "$sitesJson" | jq -r '[.value[] | select(.displayName != null and .displayName != "")] | sort_by(.displayName) | .[].id')
        mapfile -t siteUrls  < <(echo "$sitesJson" | jq -r '[.value[] | select(.displayName != null and .displayName != "")] | sort_by(.displayName) | .[].webUrl')
        mapfile -t siteNames < <(echo "$sitesJson" | jq -r '[.value[] | select(.displayName != null and .displayName != "")] | sort_by(.displayName) | .[].displayName')
    else
        siteIds=(); siteUrls=(); siteNames=()
    fi

    selectedSiteId=""
    if [[ -z "$sharepointSiteAddress" ]]; then
        siteEntries=()
        for ((i=0; i<${#siteNames[@]}; i++)); do
            siteEntries+=("${siteNames[$i]}|${siteUrls[$i]}")
        done
        idx=$(select_from_list 'Select a SharePoint site:' "${siteEntries[@]}")
        sharepointSiteAddress="${siteUrls[$idx]}"
        selectedSiteId="${siteIds[$idx]}"
        azd env set SHAREPOINT_SITE_ADDRESS "$sharepointSiteAddress" >/dev/null
        echo -e "${GREEN}Saved SHAREPOINT_SITE_ADDRESS=$sharepointSiteAddress${NC}"
    else
        for ((i=0; i<${#siteUrls[@]}; i++)); do
            if [[ "${siteUrls[$i]}" == "$sharepointSiteAddress" ]]; then
                selectedSiteId="${siteIds[$i]}"; break
            fi
        done
    fi

    if [[ -z "$sharepointFolderId" ]]; then
        if [[ -z "$selectedSiteId" ]]; then
            # Resolve via /sites/{host}:{path}
            siteHost=$(echo "$sharepointSiteAddress" | awk -F/ '{print $3}')
            sitePath=$(echo "$sharepointSiteAddress" | sed -E 's|^https?://[^/]+||' | sed -E 's|/$||')
            resolveUrl="https://graph.microsoft.com/v1.0/sites/${siteHost}:${sitePath}?\$select=id"
            resolveJson=$(graph_get "$resolveUrl" || true)
            selectedSiteId=$(echo "$resolveJson" | jq -r '.id // empty')
        fi

        if [[ -z "$selectedSiteId" ]]; then
            echo -e "${YELLOW}NOTE: Microsoft Graph could not resolve the site id (likely 'Sites.Read.All' is not consented for the Azure CLI).${NC}"
            read -r -p "Document library / folder path (press Enter for '/Shared Documents'): " manualFolder
            if [[ -z "$manualFolder" ]]; then manualFolder='/Shared Documents'; fi
            sharepointFolderId="$manualFolder"
        else
            drivesJson=$(graph_get "https://graph.microsoft.com/v1.0/sites/${selectedSiteId}/drives?\$select=id,name,webUrl" || true)
            drivesCount=$(echo "$drivesJson" | jq -r '.value | length // 0')
            if [[ -z "$drivesJson" || "$drivesCount" == "0" ]]; then
                echo -e "${YELLOW}NOTE: Microsoft Graph returned no document libraries for this site.${NC}"
                read -r -p "Document library / folder path (press Enter for '/Shared Documents'): " manualFolder
                if [[ -z "$manualFolder" ]]; then manualFolder='/Shared Documents'; fi
                sharepointFolderId="$manualFolder"
            else
                mapfile -t driveIds   < <(echo "$drivesJson" | jq -r '.value[].id')
                mapfile -t driveNames < <(echo "$drivesJson" | jq -r '.value[].name')
                driveEntries=()
                for n in "${driveNames[@]}"; do driveEntries+=("$n"); done
                idx=$(select_from_list 'Select a document library:' "${driveEntries[@]}")
                driveId="${driveIds[$idx]}"
                folderName="${driveNames[$idx]}"
                if [[ "$folderName" == "Documents" ]]; then folderName="Shared Documents"; fi
                libraryRoot="/$folderName"

                # Let the user pick the library root or drill into a subfolder.
                childrenJson=$(graph_get "https://graph.microsoft.com/v1.0/drives/${driveId}/root/children?\$select=name,folder&\$top=200" 2>/dev/null || echo "")
                childFolderEntries=("(library root: ${libraryRoot})")
                childFolderPaths=("")
                if [[ -n "$childrenJson" ]]; then
                    while IFS= read -r childName; do
                        childFolderEntries+=("$childName")
                        childFolderPaths+=("/$childName")
                    done < <(echo "$childrenJson" | jq -r '.value[] | select(.folder != null) | .name')
                fi

                if [[ ${#childFolderEntries[@]} -le 1 ]]; then
                    sharepointFolderId="$libraryRoot"
                else
                    fidx=$(select_from_list 'Select a folder (or library root):' "${childFolderEntries[@]}")
                    sharepointFolderId="${libraryRoot}${childFolderPaths[$fidx]}"
                fi
            fi
        fi
        azd env set SHAREPOINT_FOLDER_ID "$sharepointFolderId" >/dev/null
        echo -e "${GREEN}Saved SHAREPOINT_FOLDER_ID=$sharepointFolderId${NC}"
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
triggers=(
    "OnSharepointNewFile|OnNewFile|$(jq -nc --arg d "$sharepointSiteAddress" --arg f "$sharepointFolderId" '[{name:"dataset",value:$d},{name:"folderId",value:$f}]')"
    "OnSharepointUpdatedFile|OnUpdatedFile|$(jq -nc --arg d "$sharepointSiteAddress" --arg f "$sharepointFolderId" '[{name:"dataset",value:$d},{name:"folderId",value:$f}]')"
)

triggerFailures=()
for entry in "${triggers[@]}"; do
    IFS='|' read -r functionName operationName parameters <<< "$entry"

    triggerName="${sharepointConnectionName}-$(echo "$functionName" | tr '[:upper:]' '[:lower:]')"
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
fi

echo ""
echo -e "${GREEN}✅ Post-deployment configuration complete.${NC}"
echo ""
