#!/bin/bash
# Clean deployment script - removes old state and redeploys everything

set -e

# Source dfx environment
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/dfx-env.sh"

echo "🧹 Clean Deployment for Cornerstone"
echo ""

# Check if replica is running
if ! dfx ping 2>/dev/null; then
  echo "❌ Local replica is not running"
  echo "Start it with: dfx start --background"
  exit 1
fi

# Stop all canisters
echo "⏹️  Stopping canisters..."
dfx canister stop --all 2>/dev/null || true

# Delete canisters (this will also remove from canister_ids.json)
echo "🗑️  Deleting canisters..."
dfx canister delete --all --yes 2>/dev/null || true

# Remove local build state
echo "🧹 Cleaning local state..."
rm -rf .dfx/local/canisters 2>/dev/null || true

echo ""
echo "✅ Cleanup complete! Now running deployment..."
echo ""

# Run the normal deploy script
./scripts/deploy-all.sh
