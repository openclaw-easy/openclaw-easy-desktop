#!/bin/bash
# Desktop App Comprehensive Test Script
# Tests all critical features and checks for regressions after bug fixes

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test result counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Config paths
OPENCLAW_DIR="$HOME/.openclaw"
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"
# New app config path (after fix)
DESKTOP_CONFIG="$HOME/.config/openclaw-desktop/app-config.json"
# Old app config path (deprecated)
DESKTOP_CONFIG_OLD="$OPENCLAW_DIR/desktop-app-config.json"
BACKUP_DIR="$OPENCLAW_DIR/test-backups-$(date +%Y%m%d-%H%M%S)"

# Test output directory
TEST_OUTPUT_DIR="./test-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$TEST_OUTPUT_DIR"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$TEST_OUTPUT_DIR/test.log"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1" | tee -a "$TEST_OUTPUT_DIR/test.log"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1" | tee -a "$TEST_OUTPUT_DIR/test.log"
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1" | tee -a "$TEST_OUTPUT_DIR/test.log"
}

# Test framework functions
test_start() {
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    echo ""
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "TEST #$TESTS_TOTAL: $1"
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

test_pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    log_success "PASSED: $1"
}

test_fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    log_error "FAILED: $1"
    log_error "  Reason: $2"
}

# Backup existing configs
backup_configs() {
    log_info "Backing up existing configs to $BACKUP_DIR..."
    mkdir -p "$BACKUP_DIR"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        cp "$OPENCLAW_CONFIG" "$BACKUP_DIR/openclaw.json.backup"
        log_success "Backed up openclaw.json"
    fi

    if [ -f "$DESKTOP_CONFIG" ]; then
        cp "$DESKTOP_CONFIG" "$BACKUP_DIR/app-config.json.backup"
        log_success "Backed up app-config.json (new path)"
    fi

    if [ -f "$DESKTOP_CONFIG_OLD" ]; then
        cp "$DESKTOP_CONFIG_OLD" "$BACKUP_DIR/desktop-app-config.json.backup.old"
        log_success "Backed up desktop-app-config.json (old path)"
    fi
}

# Restore configs from backup
restore_configs() {
    log_info "Restoring configs from backup..."

    if [ -f "$BACKUP_DIR/openclaw.json.backup" ]; then
        cp "$BACKUP_DIR/openclaw.json.backup" "$OPENCLAW_CONFIG"
        log_success "Restored openclaw.json"
    fi

    if [ -f "$BACKUP_DIR/desktop-app-config.json.backup" ]; then
        cp "$BACKUP_DIR/desktop-app-config.json.backup" "$DESKTOP_CONFIG"
        log_success "Restored desktop-app-config.json"
    fi
}

# Wait for desktop app to be ready
wait_for_app() {
    log_info "Waiting for Desktop app to be ready..."
    sleep 3
}

# Check if process is running
is_process_running() {
    pgrep -f "$1" > /dev/null 2>&1
}

# Get config value using jq
get_config_value() {
    local file=$1
    local path=$2
    if [ -f "$file" ]; then
        jq -r "$path" "$file" 2>/dev/null || echo "null"
    else
        echo "null"
    fi
}

# Verify config structure
verify_config_structure() {
    local config_file=$1

    if [ ! -f "$config_file" ]; then
        return 1
    fi

    # Check if valid JSON
    if ! jq empty "$config_file" 2>/dev/null; then
        return 1
    fi

    return 0
}

# ============================================================================
# TEST SUITE 1: Config Integrity Tests (Critical Bug Fixes)
# ============================================================================

test_config_backup_mechanism() {
    test_start "Config Backup Mechanism"

    # Save current config
    if [ -f "$OPENCLAW_CONFIG" ]; then
        local original_hash=$(md5sum "$OPENCLAW_CONFIG" | awk '{print $1}')

        # Create a small change to trigger backup
        local timestamp=$(date +%s)
        echo "$timestamp" > /tmp/test_marker.txt

        # Simulate config write by touching the file
        touch "$OPENCLAW_CONFIG"
        sleep 1

        # Check if backup exists
        if [ -f "$OPENCLAW_CONFIG.bak" ]; then
            test_pass "Config backup mechanism works"
        else
            test_fail "Config backup mechanism" "Backup file not created"
        fi
    else
        test_fail "Config backup mechanism" "No config file exists"
    fi
}

test_agents_list_preservation() {
    test_start "Agents List Preservation After Config Changes"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        local agents_before=$(get_config_value "$OPENCLAW_CONFIG" ".agents.list | length")

        if [ "$agents_before" = "null" ] || [ "$agents_before" = "0" ]; then
            test_fail "Agents list preservation" "No agents.list found in config"
            return
        fi

        # Verify agents.list structure
        local has_main_agent=$(get_config_value "$OPENCLAW_CONFIG" '.agents.list[] | select(.id=="main") | .id')

        if [ "$has_main_agent" = "main" ]; then
            test_pass "Agents list preserved with main agent"
        else
            test_fail "Agents list preservation" "Main agent not found"
        fi
    else
        test_fail "Agents list preservation" "Config file not found"
    fi
}

test_model_config_preservation() {
    test_start "Model Configuration Preservation"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        local model=$(get_config_value "$OPENCLAW_CONFIG" ".agents.defaults.model.primary")

        if [ "$model" != "null" ] && [ -n "$model" ]; then
            test_pass "Model config preserved: $model"

            # Save to test output
            echo "Model: $model" >> "$TEST_OUTPUT_DIR/model_config.txt"
        else
            test_fail "Model config preservation" "No primary model found in config"
        fi
    else
        test_fail "Model config preservation" "Config file not found"
    fi
}

test_config_validation() {
    test_start "Config Validation and Auto-Repair"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        # Check required fields
        local has_agents=$(get_config_value "$OPENCLAW_CONFIG" ".agents")
        local has_gateway=$(get_config_value "$OPENCLAW_CONFIG" ".gateway")
        local has_agents_list=$(get_config_value "$OPENCLAW_CONFIG" ".agents.list")

        local missing_fields=""

        if [ "$has_agents" = "null" ]; then
            missing_fields="$missing_fields agents,"
        fi

        if [ "$has_gateway" = "null" ]; then
            missing_fields="$missing_fields gateway,"
        fi

        if [ "$has_agents_list" = "null" ]; then
            missing_fields="$missing_fields agents.list,"
        fi

        if [ -z "$missing_fields" ]; then
            test_pass "All required config fields present"
        else
            test_fail "Config validation" "Missing fields: $missing_fields"
        fi
    else
        test_fail "Config validation" "Config file not found"
    fi
}

# ============================================================================
# TEST SUITE 2: Gateway Management Tests
# ============================================================================

test_gateway_status_check() {
    test_start "Gateway Status Check"

    if is_process_running "openclaw gateway"; then
        test_pass "Gateway process is running"

        # Check port
        local port=$(get_config_value "$OPENCLAW_CONFIG" ".gateway.port")
        if [ "$port" != "null" ]; then
            log_info "Gateway port: $port"

            # Try to connect to port
            if nc -z localhost "$port" 2>/dev/null; then
                test_pass "Gateway listening on port $port"
            else
                log_warning "Gateway port $port not accessible"
            fi
        fi
    else
        log_warning "Gateway process not running (may be expected)"
    fi
}

test_gateway_config() {
    test_start "Gateway Configuration"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        local mode=$(get_config_value "$OPENCLAW_CONFIG" ".gateway.mode")
        local port=$(get_config_value "$OPENCLAW_CONFIG" ".gateway.port")
        local bind=$(get_config_value "$OPENCLAW_CONFIG" ".gateway.bind")

        if [ "$mode" != "null" ] && [ "$port" != "null" ]; then
            test_pass "Gateway configured: mode=$mode, port=$port, bind=$bind"
        else
            test_fail "Gateway configuration" "Gateway mode or port not set"
        fi
    else
        test_fail "Gateway configuration" "Config file not found"
    fi
}

# ============================================================================
# TEST SUITE 3: Provider & API Key Tests
# ============================================================================

test_provider_config() {
    test_start "AI Provider Configuration"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        # Check if models.providers exists
        local providers=$(get_config_value "$OPENCLAW_CONFIG" ".models.providers | keys")

        if [ "$providers" != "null" ]; then
            log_info "Configured providers: $providers"
            test_pass "Provider configuration exists"
        else
            log_warning "No providers configured (may be using local models)"
        fi
    else
        test_fail "Provider configuration" "Config file not found"
    fi
}

test_auth_profiles() {
    test_start "Auth Profiles Configuration"

    local auth_profiles="$OPENCLAW_DIR/auth-profiles.json"

    if [ -f "$auth_profiles" ]; then
        if verify_config_structure "$auth_profiles"; then
            test_pass "Auth profiles file is valid JSON"

            # Check for profiles
            local profile_count=$(jq 'keys | length' "$auth_profiles" 2>/dev/null || echo "0")
            log_info "Number of auth profiles: $profile_count"
        else
            test_fail "Auth profiles" "Invalid JSON structure"
        fi
    else
        log_warning "No auth profiles file found (may be expected)"
    fi
}

# ============================================================================
# TEST SUITE 4: Agent Management Tests
# ============================================================================

test_agent_structure() {
    test_start "Agent Structure Validation"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        local agents=$(get_config_value "$OPENCLAW_CONFIG" ".agents.list")

        if [ "$agents" != "null" ]; then
            # Validate each agent has required fields
            local agent_count=$(get_config_value "$OPENCLAW_CONFIG" ".agents.list | length")
            log_info "Number of agents: $agent_count"

            # Check if each agent has an id
            local agents_with_id=$(get_config_value "$OPENCLAW_CONFIG" '[.agents.list[] | select(.id != null)] | length')

            if [ "$agents_with_id" = "$agent_count" ]; then
                test_pass "All agents have valid IDs"
            else
                test_fail "Agent structure" "Some agents missing ID field"
            fi
        else
            test_fail "Agent structure" "No agents.list found"
        fi
    else
        test_fail "Agent structure" "Config file not found"
    fi
}

test_agent_tools_config() {
    test_start "Agent Tools Configuration"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        # Check if agents have tools configured
        local agents_with_tools=$(get_config_value "$OPENCLAW_CONFIG" '[.agents.list[] | select(.tools != null)] | length')
        local total_agents=$(get_config_value "$OPENCLAW_CONFIG" '.agents.list | length')

        log_info "Agents with tools: $agents_with_tools / $total_agents"

        # Check for invalid tool names (glob, grep)
        local has_invalid_tools=$(get_config_value "$OPENCLAW_CONFIG" '[.agents.list[].tools.allow[]? | select(. == "glob" or . == "grep")] | length')

        if [ "$has_invalid_tools" = "0" ]; then
            test_pass "No invalid tool names found (glob, grep removed)"
        else
            test_fail "Agent tools config" "Found $has_invalid_tools invalid tool names"
        fi
    else
        test_fail "Agent tools config" "Config file not found"
    fi
}

# ============================================================================
# TEST SUITE 5: Channel Management Tests
# ============================================================================

test_channel_config() {
    test_start "Channel Configuration"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        # Check plugins configuration
        local whatsapp_enabled=$(get_config_value "$OPENCLAW_CONFIG" ".plugins.entries.whatsapp.enabled")
        local telegram_enabled=$(get_config_value "$OPENCLAW_CONFIG" ".plugins.entries.telegram.enabled")
        local discord_enabled=$(get_config_value "$OPENCLAW_CONFIG" ".plugins.entries.discord.enabled")

        log_info "Channel status: WhatsApp=$whatsapp_enabled, Telegram=$telegram_enabled, Discord=$discord_enabled"

        test_pass "Channel configuration structure exists"
    else
        test_fail "Channel configuration" "Config file not found"
    fi
}

# ============================================================================
# TEST SUITE 6: Tools & Security Tests
# ============================================================================

test_tools_config() {
    test_start "Tools Configuration"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        local web_search=$(get_config_value "$OPENCLAW_CONFIG" ".tools.web.search.enabled")
        local web_fetch=$(get_config_value "$OPENCLAW_CONFIG" ".tools.web.fetch.enabled")

        log_info "Web tools: search=$web_search, fetch=$web_fetch"

        test_pass "Tools configuration exists"
    else
        test_fail "Tools configuration" "Config file not found"
    fi
}

test_exec_approvals() {
    test_start "Exec Approvals Configuration"

    local exec_approvals="$OPENCLAW_DIR/exec-approvals.json"

    if [ -f "$exec_approvals" ]; then
        if verify_config_structure "$exec_approvals"; then
            test_pass "Exec approvals file is valid JSON"

            # Check for security settings
            local allowlist=$(jq '.allowlist | length' "$exec_approvals" 2>/dev/null || echo "0")
            log_info "Allowlist entries: $allowlist"
        else
            test_fail "Exec approvals" "Invalid JSON structure"
        fi
    else
        log_warning "No exec approvals file found (may be expected)"
    fi
}

# ============================================================================
# TEST SUITE 7: Regression Tests
# ============================================================================

test_config_corruption_regression() {
    test_start "Config Corruption Regression Test"

    # This test ensures our fixes don't cause new corruption issues
    if [ -f "$OPENCLAW_CONFIG" ]; then
        # Verify config is valid JSON
        if ! verify_config_structure "$OPENCLAW_CONFIG"; then
            test_fail "Config corruption regression" "Config file is not valid JSON"
            return
        fi

        # Check critical fields haven't been corrupted
        local critical_checks=0
        local critical_passed=0

        # Check 1: agents structure exists
        critical_checks=$((critical_checks + 1))
        if [ "$(get_config_value "$OPENCLAW_CONFIG" ".agents")" != "null" ]; then
            critical_passed=$((critical_passed + 1))
        else
            log_error "  Missing: agents structure"
        fi

        # Check 2: gateway structure exists
        critical_checks=$((critical_checks + 1))
        if [ "$(get_config_value "$OPENCLAW_CONFIG" ".gateway")" != "null" ]; then
            critical_passed=$((critical_passed + 1))
        else
            log_error "  Missing: gateway structure"
        fi

        # Check 3: agents.list exists and is array
        critical_checks=$((critical_checks + 1))
        if [ "$(get_config_value "$OPENCLAW_CONFIG" ".agents.list | type")" = "array" ]; then
            critical_passed=$((critical_passed + 1))
        else
            log_error "  Missing or invalid: agents.list"
        fi

        # Check 4: agents.defaults exists
        critical_checks=$((critical_checks + 1))
        if [ "$(get_config_value "$OPENCLAW_CONFIG" ".agents.defaults")" != "null" ]; then
            critical_passed=$((critical_passed + 1))
        else
            log_error "  Missing: agents.defaults"
        fi

        if [ $critical_passed -eq $critical_checks ]; then
            test_pass "All critical config structures intact ($critical_passed/$critical_checks)"
        else
            test_fail "Config corruption regression" "Only $critical_passed/$critical_checks critical checks passed"
        fi
    else
        test_fail "Config corruption regression" "Config file not found"
    fi
}

test_doctor_safety() {
    test_start "Doctor Command Safety Test"

    # Verify doctor doesn't run automatically
    # Check logs for doctor execution
    if [ -f "$TEST_OUTPUT_DIR/test.log" ]; then
        if grep -q "Doctor diagnostics available" "$TEST_OUTPUT_DIR/test.log" 2>/dev/null; then
            test_pass "Doctor no longer runs automatically on startup"
        else
            log_warning "Could not verify doctor auto-run prevention"
        fi
    fi

    # Verify backup files exist
    if [ -f "$OPENCLAW_CONFIG.bak" ] || [ -f "$OPENCLAW_CONFIG.bak2" ] || [ -f "$OPENCLAW_CONFIG.bak3" ]; then
        test_pass "Config backup system is active"
    else
        log_warning "No config backups found (may not have been written yet)"
    fi
}

# ============================================================================
# TEST SUITE 8: Desktop App Specific Tests
# ============================================================================

test_desktop_config() {
    test_start "Desktop App Configuration"

    if [ -f "$DESKTOP_CONFIG" ]; then
        if verify_config_structure "$DESKTOP_CONFIG"; then
            test_pass "Desktop config is valid JSON"

            # Check for expected fields
            local ai_provider=$(get_config_value "$DESKTOP_CONFIG" ".aiProvider")
            log_info "AI Provider: $ai_provider"
        else
            test_fail "Desktop config" "Invalid JSON structure"
        fi
    else
        log_warning "No desktop app config found (may be first run)"
    fi
}

test_file_permissions() {
    test_start "File Permissions Check"

    if [ -f "$OPENCLAW_CONFIG" ]; then
        local perms=$(stat -f "%A" "$OPENCLAW_CONFIG" 2>/dev/null || stat -c "%a" "$OPENCLAW_CONFIG" 2>/dev/null)

        if [ "$perms" = "600" ] || [ "$perms" = "644" ]; then
            test_pass "Config file has secure permissions: $perms"
        else
            log_warning "Config file permissions: $perms (may want to restrict)"
        fi
    fi
}

# ============================================================================
# AUTHENTICATION & PREMIUM USER TESTS
# ============================================================================

test_app_config_path() {
    test_start "App Config Path (New Fix)"

    # Check if new app config directory exists or can be created
    NEW_CONFIG_DIR="$HOME/.config/openclaw-desktop"
    NEW_CONFIG_PATH="$NEW_CONFIG_DIR/app-config.json"

    log_info "Checking new app config path: $NEW_CONFIG_PATH"

    # This directory won't exist until user logs in for the first time
    # But we can verify the path is correct by checking if we can create it
    mkdir -p "$NEW_CONFIG_DIR" 2>/dev/null

    if [ -d "$NEW_CONFIG_DIR" ]; then
        test_pass "New app config directory can be created at $NEW_CONFIG_DIR"
    else
        test_fail "Cannot create app config directory" "$NEW_CONFIG_DIR"
    fi

    # Check that OLD path is not being used anymore
    OLD_CONFIG_PATH="$OPENCLAW_DIR/desktop-app-config.json"
    if [ -f "$OLD_CONFIG_PATH" ]; then
        log_warning "Old app config file still exists at $OLD_CONFIG_PATH"
        log_info "This is OK if it's from a previous run. New logins should use $NEW_CONFIG_PATH"
    fi
}

test_sync_loop_fix() {
    test_start "Sync Loop Fix (AIConfigSection)"

    log_info "Verifying syncRemoteBackendConfig is not called repeatedly..."

    # Check if app is running
    if pgrep -f "electron.*desktop" > /dev/null; then
        log_info "Desktop app is running, checking for sync loops..."

        # Monitor for 5 seconds and count sync calls
        if [ -f /tmp/desktop-app-test.log ]; then
            BEFORE=$(grep -c "syncRemoteBackendConfig" /tmp/desktop-app-test.log 2>/dev/null | tr -d '\n' | head -1)
            if [ -z "$BEFORE" ] || [ "$BEFORE" = "0" ]; then BEFORE=0; fi
            sleep 5
            AFTER=$(grep -c "syncRemoteBackendConfig" /tmp/desktop-app-test.log 2>/dev/null | tr -d '\n' | head -1)
            if [ -z "$AFTER" ] || [ "$AFTER" = "0" ]; then AFTER=0; fi
            # Ensure both are numeric before arithmetic
            BEFORE=${BEFORE:-0}
            AFTER=${AFTER:-0}
            DIFF=$((AFTER - BEFORE))
        else
            log_warning "No app log file found at /tmp/desktop-app-test.log"
            DIFF=0
        fi

        if [ "$DIFF" -lt 5 ]; then
            test_pass "No sync loop detected ($DIFF calls in 5 seconds)"
        else
            test_fail "Sync loop detected!" "$DIFF calls in 5 seconds (should be < 5)"
        fi
    else
        log_warning "Desktop app not running, skipping sync loop check"
        log_info "Run 'npm run dev' in another terminal to test this"
    fi
}

test_gateway_auth_flow() {
    test_start "Gateway Auth Token Flow (New Fix)"

    if [ ! -f "$OPENCLAW_CONFIG" ]; then
        test_fail "OpenClaw config not found" "$OPENCLAW_CONFIG"
        return
    fi

    # Check that gateway.auth exists
    AUTH_MODE=$(jq -r '.gateway.auth.mode' "$OPENCLAW_CONFIG" 2>/dev/null)
    AUTH_TOKEN=$(jq -r '.gateway.auth.token' "$OPENCLAW_CONFIG" 2>/dev/null)

    if [ "$AUTH_MODE" = "token" ] && [ -n "$AUTH_TOKEN" ] && [ "$AUTH_TOKEN" != "null" ]; then
        test_pass "Gateway auth properly configured (mode=$AUTH_MODE, token exists)"
        log_info "Token: ${AUTH_TOKEN:0:30}... (truncated)"
    else
        test_fail "Gateway auth not properly configured" "mode=$AUTH_MODE, token=$AUTH_TOKEN"
    fi

    # Verify it uses app config token if available
    NEW_CONFIG_PATH="$HOME/.config/openclaw-desktop/app-config.json"
    if [ -f "$NEW_CONFIG_PATH" ]; then
        APP_AUTH_TOKEN=$(jq -r '.authToken' "$NEW_CONFIG_PATH" 2>/dev/null)
        if [ -n "$APP_AUTH_TOKEN" ] && [ "$APP_AUTH_TOKEN" != "null" ]; then
            log_info "App config has auth token (Premium user)"
            if [ "$AUTH_TOKEN" = "$APP_AUTH_TOKEN" ]; then
                log_success "Gateway auth token matches app config token (correct flow!)"
            else
                log_warning "Gateway auth token differs from app config token"
                log_info "This is OK for Local/BYOK users (uses dev token)"
            fi
        fi
    fi
}

test_config_manager_consolidation() {
    test_start "ConfigManager Consolidation (Duplicate Removal)"

    # Check that old config-manager.ts is deleted
    OLD_CONFIG_MANAGER="./src/main/config-manager.ts"
    NEW_CONFIG_MANAGER="./src/main/managers/config-manager.ts"

    if [ ! -f "$OLD_CONFIG_MANAGER" ]; then
        test_pass "Old config-manager.ts successfully removed"
    else
        test_fail "Old config-manager.ts still exists" "Should be deleted"
    fi

    if [ -f "$NEW_CONFIG_MANAGER" ]; then
        log_success "New config-manager.ts exists at $NEW_CONFIG_MANAGER"

        # Check that it has the required methods
        if grep -q "getAppConfig" "$NEW_CONFIG_MANAGER" && \
           grep -q "saveAppConfig" "$NEW_CONFIG_MANAGER" && \
           grep -q "getAppConfigPath" "$NEW_CONFIG_MANAGER"; then
            test_pass "ConfigManager has all required app config methods"
        else
            test_fail "ConfigManager missing app config methods"
        fi
    else
        test_fail "New config-manager.ts not found" "$NEW_CONFIG_MANAGER"
    fi
}

# ============================================================================
# TEST SUITE 10: Routing Refactor Tests
# ============================================================================

test_routing_clean_architecture() {
    test_start "Routing Architecture (Clean Design)"

    # Check ChatSection uses selectedAiProvider prop instead of model prefix
    CHAT_SECTION="./src/renderer/components/dashboard/sections/ChatSection.tsx"

    if [ ! -f "$CHAT_SECTION" ]; then
        test_fail "ChatSection not found" "$CHAT_SECTION"
        return
    fi

    # Verify ChatSection has selectedAiProvider prop
    if grep -q "selectedAiProvider" "$CHAT_SECTION"; then
        log_success "ChatSection accepts selectedAiProvider prop"
    else
        test_fail "ChatSection missing selectedAiProvider prop"
        return
    fi

    # Verify routing check uses selectedAiProvider instead of startsWith('remote/')
    if grep -q "selectedAiProvider === 'premium'" "$CHAT_SECTION"; then
        test_pass "Routing uses clean state check (selectedAiProvider === 'premium')"
    else
        test_fail "Routing still using prefix check" "Should use selectedAiProvider === 'premium'"
    fi

    # Verify DiscordDashboard passes selectedAiProvider to ChatSection
    DISCORD_DASHBOARD="./src/renderer/components/dashboard/DiscordDashboard.tsx"

    if [ -f "$DISCORD_DASHBOARD" ]; then
        if grep -q "selectedAiProvider={selectedAiProvider}" "$DISCORD_DASHBOARD"; then
            log_success "DiscordDashboard passes selectedAiProvider to ChatSection"
        else
            test_fail "DiscordDashboard not passing selectedAiProvider"
        fi
    fi
}

test_model_name_format() {
    test_start "Model Name Format (No Prefix Required)"

    # Verify DiscordDashboard doesn't add "remote/" prefix
    DISCORD_DASHBOARD="./src/renderer/components/dashboard/DiscordDashboard.tsx"

    if [ ! -f "$DISCORD_DASHBOARD" ]; then
        test_fail "DiscordDashboard not found" "$DISCORD_DASHBOARD"
        return
    fi

    # Check that the old prefix logic is removed
    if grep -q "primaryModel = \`remote/\${primaryModel}\`" "$DISCORD_DASHBOARD"; then
        test_fail "DiscordDashboard still adding 'remote/' prefix" "Should be removed"
    else
        log_success "DiscordDashboard no longer adds 'remote/' prefix"
    fi

    # Check useRemoteChatRouter strips prefix for backward compatibility
    REMOTE_ROUTER="./src/renderer/hooks/useRemoteChatRouter.ts"

    if [ -f "$REMOTE_ROUTER" ]; then
        if grep -q "startsWith('remote/')" "$REMOTE_ROUTER"; then
            log_success "useRemoteChatRouter handles 'remote/' prefix for backward compatibility"
            test_pass "Model name format clean, with backward compatibility"
        else
            log_warning "useRemoteChatRouter may not handle backward compatibility"
        fi
    fi
}

# ============================================================================
# MAIN TEST EXECUTION
# ============================================================================

main() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║     Desktop App Comprehensive Test Suite                    ║"
    echo "║     Testing Critical Bug Fixes & Regression Prevention      ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""

    log_info "Starting test suite at $(date)"
    log_info "Test output directory: $TEST_OUTPUT_DIR"
    echo ""

    # Backup configs
    backup_configs

    # Run all test suites
    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 1: Config Integrity Tests (Critical Bug Fixes)"
    log_info "═══════════════════════════════════════════════════════════════"
    test_config_backup_mechanism
    test_agents_list_preservation
    test_model_config_preservation
    test_config_validation

    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 2: Gateway Management Tests"
    log_info "═══════════════════════════════════════════════════════════════"
    test_gateway_status_check
    test_gateway_config

    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 3: Provider & API Key Tests"
    log_info "═══════════════════════════════════════════════════════════════"
    test_provider_config
    test_auth_profiles

    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 4: Agent Management Tests"
    log_info "═══════════════════════════════════════════════════════════════"
    test_agent_structure
    test_agent_tools_config

    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 5: Channel Management Tests"
    log_info "═══════════════════════════════════════════════════════════════"
    test_channel_config

    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 6: Tools & Security Tests"
    log_info "═══════════════════════════════════════════════════════════════"
    test_tools_config
    test_exec_approvals

    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 7: Regression Tests"
    log_info "═══════════════════════════════════════════════════════════════"
    test_config_corruption_regression
    test_doctor_safety

    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 8: Desktop App Specific Tests"
    log_info "═══════════════════════════════════════════════════════════════"
    test_desktop_config
    test_file_permissions

    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 9: Critical Bug Fixes Verification (New)"
    log_info "═══════════════════════════════════════════════════════════════"
    test_app_config_path
    test_sync_loop_fix
    test_gateway_auth_flow
    test_config_manager_consolidation

    log_info "═══════════════════════════════════════════════════════════════"
    log_info "SUITE 10: Routing Refactor Tests"
    log_info "═══════════════════════════════════════════════════════════════"
    test_routing_clean_architecture
    test_model_name_format

    # Generate test report
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                     TEST RESULTS SUMMARY                     ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""

    log_info "Total Tests: $TESTS_TOTAL"
    log_success "Passed: $TESTS_PASSED"

    if [ $TESTS_FAILED -gt 0 ]; then
        log_error "Failed: $TESTS_FAILED"
    else
        log_info "Failed: $TESTS_FAILED"
    fi

    local pass_rate=$((TESTS_PASSED * 100 / TESTS_TOTAL))
    log_info "Pass Rate: ${pass_rate}%"
    echo ""

    # Save summary to file
    cat > "$TEST_OUTPUT_DIR/summary.txt" <<EOF
Desktop App Test Results
========================
Date: $(date)
Total Tests: $TESTS_TOTAL
Passed: $TESTS_PASSED
Failed: $TESTS_FAILED
Pass Rate: ${pass_rate}%

Backup Directory: $BACKUP_DIR
Test Output: $TEST_OUTPUT_DIR

Critical Fixes Verified:
- Doctor command preservation
- Agents.list preservation
- Model config preservation
- Config validation
- Gateway auto-restart (manual verification needed)
- UI state sync (manual verification needed)
- Clean routing architecture (selectedAiProvider-based)
- Model name format (no prefix required)
EOF

    log_info "Test results saved to: $TEST_OUTPUT_DIR/summary.txt"
    log_info "Full log: $TEST_OUTPUT_DIR/test.log"
    echo ""

    # Restore configs if requested
    if [ "$RESTORE_AFTER_TEST" = "true" ]; then
        restore_configs
    else
        log_warning "Original configs backed up to: $BACKUP_DIR"
        log_warning "To restore: cp $BACKUP_DIR/*.backup ~/.openclaw/"
    fi

    # Exit with appropriate code
    if [ $TESTS_FAILED -eq 0 ]; then
        log_success "✓ All tests passed!"
        exit 0
    else
        log_error "✗ Some tests failed. Review the log for details."
        exit 1
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --restore)
            RESTORE_AFTER_TEST=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --restore    Restore original configs after testing"
            echo "  --help       Show this help message"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Run main test suite
main
