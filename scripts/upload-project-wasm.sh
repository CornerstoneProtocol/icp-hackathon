#!/bin/bash

# Script to upload project canister WASM to the registry canister
# This allows the registry to create new project canisters

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source dfx environment
source "$SCRIPT_DIR/dfx-env.sh"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WASM_PATH="$PROJECT_ROOT/.dfx/local/canisters/project/project.wasm"

echo "=== Uploading Project WASM to Registry ==="
echo ""

# Check if WASM exists
if [ ! -f "$WASM_PATH" ]; then
    echo "Error: Project WASM not found at $WASM_PATH"
    echo "Please build the project canister first with: dfx build project"
    exit 1
fi

# Get WASM size
WASM_SIZE=$(wc -c < "$WASM_PATH" | tr -d ' ')
echo "Project WASM size: $WASM_SIZE bytes"
echo ""

# Get registry canister ID
REGISTRY_ID=$(dfx canister id registry 2>/dev/null)
if [ -z "$REGISTRY_ID" ]; then
    echo "Error: Registry canister not deployed"
    echo "Please deploy the registry canister first with: dfx deploy registry"
    exit 1
fi

echo "Registry canister ID: $REGISTRY_ID"
echo ""

# Upload WASM to registry
echo "Uploading WASM to registry..."

# Create temporary files
TEMP_ARG_FILE=$(mktemp)
trap "rm -f $TEMP_ARG_FILE" EXIT

echo "Encoding WASM..."
# Use Python to create properly escaped blob (Candid expects \xx format, not hex string)
python3 -c "
import sys
with open('$WASM_PATH', 'rb') as f:
    wasm_bytes = f.read()
escaped = ''.join(f'\\\\{b:02x}' for b in wasm_bytes)
print(f'(blob \"{escaped}\")', end='')
" > "$TEMP_ARG_FILE"

dfx canister call registry set_project_wasm --argument-file "$TEMP_ARG_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ WASM uploaded successfully!"
    echo ""

    # Verify upload
    echo "Verifying upload..."
    SIZE=$(dfx canister call registry get_project_wasm_size '()' | grep -oE '[0-9_]+' | tr -d '_' | head -1)
    echo "Stored WASM size: $SIZE bytes"

    if [ "$SIZE" == "$WASM_SIZE" ]; then
        echo "✓ Size verification passed!"
    else
        echo "⚠ Warning: Size mismatch (expected $WASM_SIZE, got $SIZE)"
    fi
else
    echo ""
    echo "✗ Failed to upload WASM"
    exit 1
fi

echo ""
echo "=== Done ==="
