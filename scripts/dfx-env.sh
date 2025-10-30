#!/bin/bash
# Common dfx environment setup for all scripts

# Prevent double-sourcing
if [ -n "$DFX_ENV_LOADED" ]; then
    return 0 2>/dev/null || exit 0
fi
export DFX_ENV_LOADED=1

# Find dfx - check common locations
if [ -z "$DFX_BIN" ]; then
    if command -v dfx &> /dev/null; then
        export DFX_BIN="$(command -v dfx)"
    elif [ -f "$HOME/Library/Application Support/org.dfinity.dfx/versions/0.29.2/dfx" ]; then
        export DFX_BIN="$HOME/Library/Application Support/org.dfinity.dfx/versions/0.29.2/dfx"
    elif [ -f "$HOME/.local/share/dfinity/versions/0.29.2/dfx" ]; then
        export DFX_BIN="$HOME/.local/share/dfinity/versions/0.29.2/dfx"
    else
        # Try to find any version
        if [ -d "$HOME/Library/Application Support/org.dfinity.dfx/versions" ]; then
            LATEST_VERSION=$(ls -1 "$HOME/Library/Application Support/org.dfinity.dfx/versions" | sort -V | tail -1)
            if [ -n "$LATEST_VERSION" ] && [ -f "$HOME/Library/Application Support/org.dfinity.dfx/versions/$LATEST_VERSION/dfx" ]; then
                export DFX_BIN="$HOME/Library/Application Support/org.dfinity.dfx/versions/$LATEST_VERSION/dfx"
            fi
        fi
    fi

    if [ -z "$DFX_BIN" ]; then
        echo "❌ dfx not found. Please install dfx: https://internetcomputer.org/docs/current/developer-docs/setup/install/"
        exit 1
    fi
fi

# Use an alias instead of a function to avoid recursion
alias dfx="$DFX_BIN"