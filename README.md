# Cornerstone ICP Backend

Rust canister implementation of the Cornerstone protocol for the Internet Computer. It ports the lifecycle rules from the Solidity version (fundraising, phased developer unlocks, reserve-funded interest, principal redemption, and per-share revenue) while exposing canister APIs suitable for hackathon submissions.

## Repository Layout

- `packages/core` – pure Rust domain layer with `ProjectState` and `RegistryState` plus extensive unit tests.
- `canisters/project` – ICP canister wrapper exposing the project lifecycle API over Candid.
- `canisters/registry` – ICP canister for tracking created projects and their deployed canister principals.

## Features

- 6-phase project lifecycle with document submissions per phase and progressive phase 5 unlocks.
- Reserve-funded APR accrual using ICP time with per-share accounting and transfer-aware corrections.
- Developer withdrawal caps aligned to fundraising phases, pause / unpause controls, and failure refunds.
- Principal buffer and revenue distribution logic mirroring the Ethereum contracts, including share burn/redemption.
- Registry canister that records project metadata and assigns deployed canister principals.

## Local Development

1. **Install toolchain**
   - Rust 1.79+ (`rustup default stable`).
   - (Optional) DFX 0.15+ if deploying to a replica.
2. **Fetch dependencies & run tests**
   ```bash
   cargo test
   ```
   Tests in `packages/core` mirror the Hardhat suite (interest accrual, refunds, developer caps, pause). They provide confidence before compiling to Wasm.
3. **Build Wasm for deployment**
   ```bash
   cargo build --release --target wasm32-unknown-unknown -p project-canister
   cargo build --release --target wasm32-unknown-unknown -p registry-canister
   ```
   Generated Wasm binaries live under `target/wasm32-unknown-unknown/release/` and can be installed with `dfx canister install` or via the management canister.
4. **Generate Candid (optional)**
   After building with `dfx build`, run:
   ```bash
   dfx generate project
   dfx generate registry
   ```
   The generated `.did` files will appear alongside the canisters under `canisters/<name>/`.

## Next Steps & Hackathon Notes

- Wire the registry to automatically install project canisters using the management canister APIs once Wasm artifacts are uploaded.
- Integrate Chain Fusion ledgers (ckUSDC/ckBTC) by replacing the placeholder accounting transfers with real ledger calls.
- Layer in tamper-proof document storage (e.g., doc notarization canister) and identity integration for the legal-tech track.
- Prepare demo scripts plus a video walkthrough highlighting architecture, tests, and mainnet deployment steps.

Refer to the Solidity contracts under `cornerstone-prototype/contracts` for behavioural parity; each major flow now has a Rust equivalent covered by tests.
