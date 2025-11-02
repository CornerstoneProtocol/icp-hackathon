#!/bin/bash

# Test runner script for Cornerstone ICP canisters
set -e

echo "  Cornerstone ICP Canister Test Suite"
echo

# Step 1: Build canisters
echo "Building canisters..."
./scripts/build-canisters.sh
echo

# Step 2: Run tests
echo "Running tests..."
echo

if [ "$1" == "project" ]; then
    echo "Running project tests only..."
    cargo test --test project_tests -- --nocapture
elif [ "$1" == "registry" ]; then
    echo "Running registry tests only..."
    cargo test --test registry_tests -- --nocapture
elif [ "$1" == "integration" ]; then
    echo "Running integration tests only..."
    cargo test --test integration_tests -- --nocapture
elif [ "$1" == "coverage" ]; then
    echo "Running tests with coverage..."
    cargo tarpaulin --out Html --output-dir coverage
else
    echo "Running all tests..."
    cargo test -- --nocapture
fi

echo
echo "  ✓ All tests completed"
