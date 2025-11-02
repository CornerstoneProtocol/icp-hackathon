#!/bin/bash

# Build script for Cornerstone ICP canisters
set -e

echo "Building canisters..."

# Build all canisters for wasm32
cargo build --release --target wasm32-unknown-unknown

# Copy wasm files to expected locations (if needed)
mkdir -p target/wasm32-unknown-unknown/release/

# Rename canisters if needed to match test expectations
if [ -f "target/wasm32-unknown-unknown/release/project.wasm" ]; then
    cp target/wasm32-unknown-unknown/release/project.wasm \
       target/wasm32-unknown-unknown/release/project_canister.wasm
fi

if [ -f "target/wasm32-unknown-unknown/release/registry.wasm" ]; then
    cp target/wasm32-unknown-unknown/release/registry.wasm \
       target/wasm32-unknown-unknown/release/registry_canister.wasm
fi

echo "✓ Canisters built successfully"
ls -lh target/wasm32-unknown-unknown/release/*.wasm