#!/bin/bash
# Complete deployment script for local development

set -e

# Source dfx environment if available
if [ -f "$HOME/Library/Application Support/org.dfinity.dfx/env" ]; then
  source "$HOME/Library/Application Support/org.dfinity.dfx/env"
fi

echo "🚀 Deploying Cornerstone to Local ICP..."

# Check if replica is running
if ! dfx ping 2>/dev/null; then
  echo "❌ Local replica is not running"
  echo "Start it with: dfx start --background"
  exit 1
fi

# Deploy registry
echo ""
echo "📋 Deploying Registry Canister..."
dfx deploy registry --argument '(null)'

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
echo "🎉 Access your application at:"
dfx canister call frontend http_request '(record{url="/";headers=vec{};method="GET";body=vec{}})' | grep -o 'http://[^"]*' || echo "Run 'dfx canister id frontend' to get the canister ID"
