use candid::Principal;
use cornerstone_core::{ProjectParams};

pub fn create_principal(id: u8) -> Principal {
    Principal::from_slice(&[id; 29])
}

pub fn default_params() -> ProjectParams {
    ProjectParams {
        stablecoin: "ckUSDC".to_string(),
        min_raise: 1_000_000,
        max_raise: 5_000_000,
        fundraise_deadline: 1_000_000,
        phase_aprs_bps: [0, 1000, 900, 800, 700, 600],
        phase_durations: [0, 30, 30, 30, 30, 30],
        phase_withdraw_caps_bps: [0, 1500, 1500, 1500, 2500, 2500],
        token_name: "Cornerstone Token".to_string(),
        token_symbol: "cAGG-TEST".to_string(),
    }
}

pub const YEAR_SECONDS: u64 = 31_536_000;

/// Get the WASM module path for a canister
pub fn get_wasm_path(canister: &str) -> String {
    match canister {
        "project" => "target/wasm32-unknown-unknown/release/project_canister.wasm".to_string(),
        "registry" => "target/wasm32-unknown-unknown/release/registry_canister.wasm".to_string(),
        _ => panic!("Unknown canister: {}", canister),
    }
}

/// Read a WASM module
pub fn read_wasm(canister: &str) -> Vec<u8> {
    let path = get_wasm_path(canister);
    std::fs::read(&path)
        .unwrap_or_else(|_| panic!("Failed to read WASM from {}. Run 'cargo build --release --target wasm32-unknown-unknown' first", path))
}