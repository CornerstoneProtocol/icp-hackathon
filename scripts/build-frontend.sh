#!/bin/bash
# Build script for the Cornerstone frontend

set -e

# Source dfx environment if available
if [ -f "$HOME/Library/Application Support/org.dfinity.dfx/env" ]; then
  source "$HOME/Library/Application Support/org.dfinity.dfx/env"
fi

echo "🏗️  Building Cornerstone Frontend..."

# Navigate to app directory
cd "$(dirname "$0")/../app"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Build the frontend
echo "⚡ Building with Vite..."
npm run build

echo "✅ Frontend built successfully!"
echo "📁 Output directory: $(pwd)/dist"
echo ""
echo "To deploy, run from the project root:"
echo "  dfx deploy frontend"
