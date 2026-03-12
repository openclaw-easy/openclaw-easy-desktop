#!/bin/bash
# Openclaw Easy macOS Pre-Installation Script
# System requirements and existing installation check

set -e

LOG_FILE="/tmp/openclaw-easy-install.log"
APP_PATH="/Applications/Openclaw Easy.app"

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
    echo "[Openclaw Easy] $1"
}

error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - ERROR: $1" >> "$LOG_FILE"
    echo "[ERROR] $1" >&2
}

# Main installation checks
main() {
    log "=== Openclaw Easy Pre-Installation Starting ==="

    # Check macOS version
    OS_VERSION=$(sw_vers -productVersion)
    MAJOR_VERSION=$(echo "$OS_VERSION" | cut -d. -f1)
    MINOR_VERSION=$(echo "$OS_VERSION" | cut -d. -f2)

    if [[ $MAJOR_VERSION -lt 10 ]] || ([[ $MAJOR_VERSION -eq 10 ]] && [[ $MINOR_VERSION -lt 15 ]]); then
        error "macOS 10.15 or later is required. You have $OS_VERSION"
        exit 1
    fi
    log "macOS version: $OS_VERSION ✓"

    # Check available disk space
    DISK_AVAILABLE=$(df -g / | awk 'NR==2 {print $4}')
    if [[ $DISK_AVAILABLE -lt 1 ]]; then
        error "Insufficient disk space. At least 1GB required, ${DISK_AVAILABLE}GB available."
        exit 1
    fi
    log "Available disk space: ${DISK_AVAILABLE}GB ✓"

    # Note: Internet connectivity no longer required - OpenClaw is embedded
    log "OpenClaw embedded in app - no external dependencies required ✓"

    # Check for existing Openclaw Easy installation
    if [ -d "$APP_PATH" ]; then
        log "Existing Openclaw Easy installation found at: $APP_PATH"
        echo ""
        echo "⚠️  Existing Openclaw Easy installation detected!"
        echo "====================================="

        # Get version info if possible
        local current_version="unknown"
        if [ -f "$APP_PATH/Contents/Info.plist" ]; then
            current_version=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "unknown")
        fi
        echo "   Current version: $current_version"
        log "Current version: $current_version"

        # Use osascript to ask user for confirmation
        local user_choice
        user_choice=$(osascript <<EOF 2>/dev/null || echo "Cancel"
set dialogResult to button returned of (display dialog "Openclaw Easy is already installed.\n\nCurrent version: $current_version\nNew version: 1.1.0\n\nThe existing installation will be replaced. Your settings will be preserved.\n\nDo you want to continue?" with title "Openclaw Easy Installer" buttons {"Cancel", "Replace"} default button "Replace" with icon caution)
return dialogResult
EOF
        )

        if [ "$user_choice" = "Cancel" ]; then
            echo "❌ Installation cancelled by user"
            log "Installation cancelled by user - existing app retained"
            exit 128  # User cancelled - special exit code
        else
            echo "✅ User approved replacement of existing installation"
            log "User approved replacement of existing installation"

            # Backup note about existing configuration
            local config_dir="$HOME/Library/Application Support/Openclaw Easy"
            if [ -d "$config_dir" ]; then
                echo "   Note: Existing configuration will be preserved"
                log "Configuration will be preserved at: $config_dir"
            fi

            # The PKG installer will handle the actual replacement
            # We don't need to manually remove the app here
            echo "   Existing app will be replaced during installation"
        fi
    else
        echo "✅ No existing Openclaw Easy installation found - fresh install"
        log "No existing installation found - proceeding with fresh install"
    fi

    # OpenClaw is now embedded in Openclaw Easy
    echo "✅ OpenClaw is embedded in Openclaw Easy - no external installation needed"
    log "OpenClaw embedded in app - no external installation required"

    # Note: Node.js no longer required - OpenClaw runs embedded in Electron
    log "Node.js not required - OpenClaw runs in embedded environment ✓"

    log "Pre-installation checks complete ✓"
    exit 0
}

# Run main function
main "$@"