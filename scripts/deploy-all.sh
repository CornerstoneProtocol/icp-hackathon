#!/bin/bash
# Complete deployment script for local development

set -e

# Source dfx environment
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/dfx-env.sh"

echo "🚀 Deploying Cornerstone to Local ICP..."

# Check if replica is running
if ! dfx ping 2>/dev/null; then
  echo "❌ Local replica is not running"
  echo "Start it with: dfx start --background"
  exit 1
fi

# Create canisters first
echo ""
echo "🆔 Creating Canister IDs..."
dfx canister create --all

# Build all canisters
echo ""
echo "🔨 Building All Canisters..."
dfx build

# Deploy registry
echo ""
echo "📋 Deploying Registry Canister..."
dfx deploy registry --argument '(null)' --yes

# Upload project WASM to registry
echo ""
echo "📤 Uploading Project WASM to Registry..."
WASM_PATH=".dfx/local/canisters/project/project.wasm"

if [ ! -f "$WASM_PATH" ]; then
    echo "❌ Error: Project WASM not found at $WASM_PATH"
    exit 1
fi

WASM_SIZE=$(wc -c < "$WASM_PATH" | tr -d ' ')
echo "   WASM size: $WASM_SIZE bytes"

echo "   Encoding WASM..."

# Create temporary file
TEMP_ARG_FILE=$(mktemp)
trap "rm -f $TEMP_ARG_FILE" EXIT

# Use Python to create properly escaped blob (Candid expects \xx format, not hex string)
python3 -c "
import sys
with open('$WASM_PATH', 'rb') as f:
    wasm_bytes = f.read()
escaped = ''.join(f'\\\\{b:02x}' for b in wasm_bytes)
print(f'(blob \"{escaped}\")', end='')
" > "$TEMP_ARG_FILE"

echo "   Calling set_project_wasm..."
dfx canister call registry set_project_wasm --argument-file "$TEMP_ARG_FILE"

if [ $? -eq 0 ]; then
    echo "   ✓ WASM uploaded successfully!"
    # Verify upload
    SIZE=$(dfx canister call registry get_project_wasm_size '()' | grep -oE '[0-9_]+' | tr -d '_' | head -1)
    if [ "$SIZE" == "$WASM_SIZE" ]; then
        echo "   ✓ Size verification passed!"
    else
        echo "   ⚠ Warning: Size mismatch (expected $WASM_SIZE, got $SIZE)"
    fi
else
    echo "   ❌ Failed to upload WASM"
    exit 1
fi

# Update frontend environment with canister IDs
echo ""
echo "📝 Updating Frontend Environment..."
REGISTRY_ID=$(dfx canister id registry)
MOCK_CKBTC_ID=$(dfx canister id mock_ckusdc 2>/dev/null || echo "")

cat > app/.env.local <<ENV_FILE
VITE_IC_HOST=http://127.0.0.1:4943
VITE_REGISTRY_CANISTER_ID=${REGISTRY_ID}
VITE_CKBTC_CANISTER_ID=${MOCK_CKBTC_ID}
VITE_CKUSDT_CANISTER_ID=<ckUSDT-canister-id>
ENV_FILE

echo "   ✓ Updated app/.env.local with canister IDs"
echo "   Registry: $REGISTRY_ID"
echo "   Mock ckUSDC: $MOCK_CKBTC_ID"

# Build frontend
echo ""
echo "🏗️  Building Frontend..."
./scripts/build-frontend.sh

# Deploy frontend
echo ""
echo "🌐 Deploying Frontend Canister..."
dfx deploy frontend

echo ""
echo "✅ All canisters deployed successfully!"
echo ""
echo "📊 Deployed Canister IDs:"
echo "   Registry: $REGISTRY_ID"
echo "   Mock ckUSDC: $MOCK_CKBTC_ID"
echo "   Frontend: $(dfx canister id frontend)"
echo ""
echo "🎉 Access your application at:"
FRONTEND_ID=$(dfx canister id frontend)
echo "   http://${FRONTEND_ID}.localhost:4943/"
