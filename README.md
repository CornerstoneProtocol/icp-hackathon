# Cornerstone ICP Backend (Legal Tech Hackathon)

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
   - DFX 0.15+ for deploying to a local replica.
2. **Fetch dependencies & run tests**
   ```bash
   cargo test
   ```
   Tests in `packages/core` mirror the Hardhat suite (interest accrual, refunds, developer caps, pause). They provide confidence before compiling to Wasm.
3. **Start local replica**
   ```bash
   dfx start --clean --background
   ```
4. **Deploy Registry Canister**

   Deploy the registry with an owner principal:
   ```bash
   dfx deploy registry --argument '(opt record { owner = opt principal "YOUR_PRINCIPAL_ID" })'
   ```

   Or deploy without an owner:
   ```bash
   dfx deploy registry --argument '(null)'
   ```

   To get your principal ID:
   ```bash
   dfx identity get-principal
   ```

5. **Deploy Project Canister**

   First, create a `project_args.did` file with initialization parameters:
   ```candid
   (record {
     params = record {
       stablecoin = "ckUSDC";
       min_raise = 100_000_000_000;
       max_raise = 1_000_000_000_000;
       fundraise_deadline = 1_735_689_600_000_000_000;
       phase_aprs_bps = vec { 500; 500; 500; 500; 500; 500 };
       phase_durations = vec { 15_552_000_000_000_000; 15_552_000_000_000_000; 15_552_000_000_000_000; 15_552_000_000_000_000; 15_552_000_000_000_000; 15_552_000_000_000_000 };
       phase_withdraw_caps_bps = vec { 2000; 2000; 2000; 2000; 2000; 2000 };
       token_name = "Example Project Token";
       token_symbol = "EPT";
     };
   })
   ```

   Then deploy:
   ```bash
   dfx deploy project --argument-file project_args.did
   ```

   **Parameter Details:**
   - `stablecoin`: Token identifier (e.g., "ckUSDC")
   - `min_raise` / `max_raise`: Minimum/maximum fundraise amounts in base units
   - `fundraise_deadline`: Deadline in nanoseconds since Unix epoch
   - `phase_aprs_bps`: APR for each of 6 phases in basis points (500 = 5%)
   - `phase_durations`: Duration of each phase in nanoseconds
   - `phase_withdraw_caps_bps`: Withdrawal cap per phase in basis points (2000 = 20%)
   - `token_name` / `token_symbol`: Project token metadata

6. **Interact with Canisters**

   Access the Candid UI for testing:
   ```bash
   # Get the Candid UI URL
   dfx canister call registry get_project '(0)'
   ```

   Or use the URLs displayed after deployment to interact via the browser interface.

7. **Build Wasm manually (optional)**
   ```bash
   cargo build --release --target wasm32-unknown-unknown -p project-canister
   cargo build --release --target wasm32-unknown-unknown -p registry-canister
   ```
   Generated Wasm binaries live under `target/wasm32-unknown-unknown/release/` and can be installed with `dfx canister install` or via the management canister.

## Next Steps & Hackathon Notes

- Wire the registry to automatically install project canisters using the management canister APIs once Wasm artifacts are uploaded.
- Integrate Chain Fusion ledgers (ckUSDC/ckBTC) by replacing the placeholder accounting transfers with real ledger calls.
- Layer in tamper-proof document storage (e.g., doc notarization canister) and identity integration for the legal-tech track.
- Prepare demo scripts plus a video walkthrough highlighting architecture, tests, and mainnet deployment steps.

Refer to the Solidity contracts under `cornerstone-prototype/contracts` for behavioural parity; each major flow now has a Rust equivalent covered by tests.
