#!/bin/bash
# Clean deployment script - removes old state and redeploys everything
# BUT preserves mock_ckusdc canister to keep minted tokens

set -e

# Source dfx environment
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/dfx-env.sh"

echo "🧹 Clean Deployment for Cornerstone (preserving mock_ckusdc)"
echo ""

# Check if replica is running
if ! dfx ping 2>/dev/null; then
  echo "❌ Local replica is not running"
  echo "Start it with: dfx start --background"
  exit 1
fi

# Save mock_ckusdc canister ID if it exists
MOCK_CKUSDC_ID=""
if dfx canister id mock_ckusdc 2>/dev/null; then
  MOCK_CKUSDC_ID=$(dfx canister id mock_ckusdc)
  echo "💾 Preserving mock_ckusdc canister: $MOCK_CKUSDC_ID"
fi

# Stop all canisters except mock_ckusdc
echo "⏹️  Stopping canisters (except mock_ckusdc)..."
for canister in project registry frontend; do
  dfx canister stop $canister 2>/dev/null || true
done

# Delete canisters except mock_ckusdc
echo "🗑️  Deleting canisters (except mock_ckusdc)..."
for canister in project registry frontend; do
  dfx canister delete $canister --yes 2>/dev/null || true
done

# Clean local build state but preserve mock_ckusdc
echo "🧹 Cleaning local state (preserving mock_ckusdc)..."
if [ -d ".dfx/local/canisters" ]; then
  for canister in project registry frontend; do
    rm -rf ".dfx/local/canisters/$canister" 2>/dev/null || true
  done
fi

echo ""
echo "✅ Cleanup complete! Now running deployment..."
echo ""

# Run the normal deploy script
./scripts/deploy-all.sh
