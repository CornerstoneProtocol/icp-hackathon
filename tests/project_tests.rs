use candid::{encode_one, Principal};
use pocket_ic::PocketIc;
use std::time::Duration;

// Test utilities
fn create_principal(id: u8) -> Principal {
    Principal::from_slice(&[id; 29])
}

fn default_params() -> cornerstone_core::ProjectParams {
    cornerstone_core::ProjectParams {
        stablecoin: "ckUSDC".to_string(),
        min_raise: 1_000_000,
        max_raise: 5_000_000,
        fundraise_deadline: u64::MAX, // Far future to avoid timing issues
        phase_aprs_bps: [0, 1000, 900, 800, 700, 600],
        phase_durations: [0, 30, 30, 30, 30, 30],
        phase_withdraw_caps_bps: [0, 1500, 1500, 1500, 2500, 2500],
        token_name: "Cornerstone Token".to_string(),
        token_symbol: "cAGG-TEST".to_string(),
    }
}

fn create_doc_record(label: &str) -> cornerstone_core::DocRecord {
    cornerstone_core::DocRecord {
        doc_types: vec![label.to_string()],
        doc_hashes: vec!["hash".to_string()],
        metadata_uris: vec![format!("ipfs://{}", label)],
        submitted_at: 0,
    }
}

#[test]
fn test_deposit_mints_shares_and_marks_success() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user = create_principal(2);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = project_canister::InitArgs {
        params: default_params(),
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposit as user
    let result = pic.update_call(
        canister_id,
        user,
        "deposit",
        encode_one(1_200_000u128).unwrap(),
    )
    .expect("deposit call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("deposit returned error");
    
    // Get state
    let state_bytes = pic.query_call(
        canister_id,
        user,
        "get_state",
        encode_one(()).unwrap(),
    )
    .expect("get_state failed");
    
    let state: cornerstone_core::ProjectState = 
        candid::decode_one(&state_bytes).unwrap();
    
    assert_eq!(state.total_raised, 1_200_000);
    assert!(state.fundraise_successful);
    assert_eq!(state.total_supply, 1_200_000);
    
    // Check user balance
    let balance = state.accounts.get(&user).map(|a| a.balance).unwrap_or(0);
    assert_eq!(balance, 1_200_000);
}

#[test]
fn test_close_phase_advances_and_records_docs() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user = create_principal(2);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = project_canister::InitArgs {
        params: default_params(),
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposit minimum raise
    let result = pic.update_call(
        canister_id,
        user,
        "deposit",
        encode_one(1_200_000u128).unwrap(),
    )
    .expect("deposit call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("deposit returned error");
    
    // Close phase 0
    let doc = create_doc_record("phase-0");
    let result = pic.update_call(
        canister_id,
        dev,
        "close_phase",
        candid::encode_args((0u8, doc)).unwrap(),
    )
    .expect("close_phase call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("close_phase returned error");
    
    let state_bytes = pic.query_call(
        canister_id,
        dev,
        "get_state",
        encode_one(()).unwrap(),
    )
    .unwrap();
    
    let state: cornerstone_core::ProjectState = 
        candid::decode_one(&state_bytes).unwrap();
    
    assert_eq!(state.current_phase, 1);
    assert_eq!(state.phase_docs[0].len(), 1);
    assert!(!state.fundraise_closed);
}

#[test]
fn test_close_phase_reverts_if_min_not_met() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user = create_principal(2);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = project_canister::InitArgs {
        params: default_params(),
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposit less than minimum
    let result = pic.update_call(
        canister_id,
        user,
        "deposit",
        encode_one(500_000u128).unwrap(),
    )
    .expect("deposit call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("deposit returned error");
    
    // Try to close phase 0
    let doc = create_doc_record("phase-0");
    let result = pic.update_call(
        canister_id,
        dev,
        "close_phase",
        candid::encode_args((0u8, doc)).unwrap(),
    )
    .expect("close_phase call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    assert!(response.is_err());
}

#[test]
fn test_deposits_blocked_in_phase_five() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user = create_principal(2);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = project_canister::InitArgs {
        params: default_params(),
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposit
    let result = pic.update_call(
        canister_id,
        user,
        "deposit",
        encode_one(1_200_000u128).unwrap(),
    )
    .expect("deposit call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("deposit returned error");
    
    // Close phases 0-4
    for phase in 0u8..=4u8 {
        let doc = create_doc_record(&format!("phase-{}", phase));
        let result = pic.update_call(
            canister_id,
            dev,
            "close_phase",
            candid::encode_args((phase, doc)).unwrap(),
        )
        .expect("close_phase call failed");
        
        let response: Result<(), String> = candid::decode_one(&result).unwrap();
        response.expect(&format!("close_phase {} returned error", phase));
    }
    
    // Try to deposit in phase 5
    let result = pic.update_call(
        canister_id,
        user,
        "deposit",
        encode_one(1u128).unwrap(),
    )
    .expect("deposit call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    assert!(response.is_err());
    assert!(response.unwrap_err().contains("deposits closed"));
}

#[test]
fn test_interest_accrual_and_claims() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user1 = create_principal(2);
    let user2 = create_principal(3);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let mut params = default_params();
    params.phase_aprs_bps = [0, 1000, 800, 600, 400, 200];
    
    let init_args = project_canister::InitArgs {
        params,
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposits
    pic.update_call(canister_id, user1, "deposit", encode_one(700_000u128).unwrap())
        .expect("deposit call failed");
    pic.update_call(canister_id, user2, "deposit", encode_one(800_000u128).unwrap())
        .expect("deposit call failed");
    
    // Fund reserve
    let result = pic.update_call(canister_id, dev, "fund_reserve", encode_one(800_000u128).unwrap())
        .expect("fund_reserve call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("fund_reserve returned error");
    
    // Close phase 0
    let doc = create_doc_record("phase-0");
    let result = pic.update_call(
        canister_id,
        dev,
        "close_phase",
        candid::encode_args((0u8, doc)).unwrap(),
    )
    .expect("close_phase call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("close_phase returned error");
    
    // Advance time by 1 year
    pic.advance_time(Duration::from_secs(31_536_000));
    
    // Accrue interest
    let result = pic.update_call(canister_id, user1, "accrue_interest", encode_one(()).unwrap())
        .expect("accrue_interest call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("accrue_interest returned error");
    
    // Check claimable interest
    let claimable1_bytes = pic.query_call(
        canister_id,
        user1,
        "claimable_interest",
        encode_one(user1).unwrap(),
    )
    .unwrap();
    
    let claimable1: u128 = candid::decode_one(&claimable1_bytes).unwrap();
    assert!(claimable1 > 0);
    
    // Claim half of interest
    let half_claim = claimable1 / 2;
    let result = pic.update_call(
        canister_id,
        user1,
        "claim_interest",
        encode_one(half_claim).unwrap(),
    )
    .expect("claim_interest call failed");
    let response: Result<u128, String> = candid::decode_one(&result).unwrap();
    response.expect("claim_interest returned error");
    
    // Verify remaining claimable reduced
    let remaining_bytes = pic.query_call(
        canister_id,
        user1,
        "claimable_interest",
        encode_one(user1).unwrap(),
    )
    .unwrap();
    
    let remaining: u128 = candid::decode_one(&remaining_bytes).unwrap();
    assert!(remaining < claimable1);
}

#[test]
fn test_revenue_distribution_and_principal_redemption() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user = create_principal(2);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = project_canister::InitArgs {
        params: default_params(),
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposit
    let result = pic.update_call(canister_id, user, "deposit", encode_one(1_500_000u128).unwrap())
        .expect("deposit call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("deposit returned error");
    
    // Close phase 0
    let doc = create_doc_record("phase-0");
    let result = pic.update_call(
        canister_id,
        dev,
        "close_phase",
        candid::encode_args((0u8, doc)).unwrap(),
    )
    .expect("close_phase call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("close_phase returned error");
    
    // Submit sales proceeds (principal buffer)
    let result = pic.update_call(
        canister_id,
        dev,
        "submit_sales_proceeds",
        encode_one(1_000_000u128).unwrap(),
    )
    .expect("submit_sales_proceeds call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("submit_sales_proceeds returned error");
    
    let state_bytes = pic.query_call(
        canister_id,
        dev,
        "get_state",
        encode_one(()).unwrap(),
    )
    .unwrap();
    
    let state: cornerstone_core::ProjectState = candid::decode_one(&state_bytes).unwrap();
    assert_eq!(state.principal_buffer, 1_000_000);
    
    // Submit more proceeds to create revenue
    let result = pic.update_call(
        canister_id,
        dev,
        "submit_sales_proceeds",
        encode_one(700_000u128).unwrap(),
    )
    .expect("submit_sales_proceeds call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("submit_sales_proceeds returned error");
    
    // Check claimable revenue
    let revenue_bytes = pic.query_call(
        canister_id,
        user,
        "claimable_revenue",
        encode_one(user).unwrap(),
    )
    .unwrap();
    
    let revenue: u128 = candid::decode_one(&revenue_bytes).unwrap();
    assert!(revenue > 0);
    
    // Claim revenue
    let result = pic.update_call(canister_id, user, "claim_revenue", encode_one(()).unwrap())
        .expect("claim_revenue call failed");
    let response: Result<u128, String> = candid::decode_one(&result).unwrap();
    response.expect("claim_revenue returned error");
    
    // Withdraw principal
    let withdraw_result = pic.update_call(
        canister_id,
        user,
        "withdraw_principal",
        encode_one(700_000u128).unwrap(),
    )
    .expect("withdraw_principal call failed");
    
    let withdrawn: Result<u128, String> = 
        candid::decode_one(&withdraw_result).unwrap();
    assert_eq!(withdrawn.unwrap(), 700_000);
}

#[test]
fn test_submit_appraisal_requires_phase_five() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user = create_principal(2);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = project_canister::InitArgs {
        params: default_params(),
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposit
    pic.update_call(canister_id, user, "deposit", encode_one(1_200_000u128).unwrap())
        .expect("deposit call failed");
    
    // Fund reserve
    let result = pic.update_call(canister_id, dev, "fund_reserve", encode_one(500_000u128).unwrap())
        .expect("fund_reserve call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("fund_reserve returned error");
    
    // Close phase 0
    let doc = create_doc_record("phase-0");
    let result = pic.update_call(
        canister_id,
        dev,
        "close_phase",
        candid::encode_args((0u8, doc)).unwrap(),
    )
    .expect("close_phase call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("close_phase returned error");
    
    // Try to submit appraisal in phase 1 (should fail)
    let result = pic.update_call(
        canister_id,
        dev,
        "submit_appraisal",
        candid::encode_args((10u8, "hash1".to_string())).unwrap(),
    )
    .expect("submit_appraisal call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    assert!(response.is_err());
    
    // Close phases 1-4
    for phase in 1u8..=4u8 {
        let doc = create_doc_record(&format!("phase-{}", phase));
        let result = pic.update_call(
            canister_id,
            dev,
            "close_phase",
            candid::encode_args((phase, doc)).unwrap(),
        )
        .expect("close_phase call failed");
        let response: Result<(), String> = candid::decode_one(&result).unwrap();
        response.expect(&format!("close_phase {} returned error", phase));
    }
    
    // Now in phase 5, appraisal should work
    let result = pic.update_call(
        canister_id,
        dev,
        "submit_appraisal",
        candid::encode_args((40u8, "hash2".to_string())).unwrap(),
    )
    .expect("submit_appraisal call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("submit_appraisal returned error");
    
    let state_bytes = pic.query_call(
        canister_id,
        dev,
        "get_state",
        encode_one(()).unwrap(),
    )
    .unwrap();
    
    let state: cornerstone_core::ProjectState = candid::decode_one(&state_bytes).unwrap();
    assert_eq!(state.phase5_percent_complete, 40);
    
    // Try to submit lower percentage (should fail)
    let result = pic.update_call(
        canister_id,
        dev,
        "submit_appraisal",
        candid::encode_args((39u8, "hash3".to_string())).unwrap(),
    )
    .expect("submit_appraisal call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    assert!(response.is_err());
}

#[test]
fn test_developer_withdraw_respects_caps() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user = create_principal(2);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = project_canister::InitArgs {
        params: default_params(),
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposit
    pic.update_call(canister_id, user, "deposit", encode_one(1_500_000u128).unwrap())
        .expect("deposit call failed");
    
    // Fund reserve
    let result = pic.update_call(canister_id, dev, "fund_reserve", encode_one(500_000u128).unwrap())
        .expect("fund_reserve call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("fund_reserve returned error");
    
    // Close phases 0 and 1
    for phase in 0u8..=1u8 {
        let doc = create_doc_record(&format!("phase-{}", phase));
        let result = pic.update_call(
            canister_id,
            dev,
            "close_phase",
            candid::encode_args((phase, doc)).unwrap(),
        )
        .expect("close_phase call failed");
        let response: Result<(), String> = candid::decode_one(&result).unwrap();
        response.expect(&format!("close_phase {} returned error", phase));
    }
    
    // With max_raise = 5_000_000 and phase_withdraw_caps_bps = [0, 1500, 1500, ...]
    // Cumulative cap after phases 0-1:
    // Phase 0: 0% of 5M = 0
    // Phase 1: 15% of 5M = 750,000
    // Total: 750,000
    
    // Try to withdraw more than cap (800,000 > 750,000)
    let result = pic.update_call(
        canister_id,
        dev,
        "withdraw_phase_funds",
        encode_one(800_000u128).unwrap(),
    )
    .expect("withdraw_phase_funds call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    assert!(response.is_err(), "Expected error when withdrawing 800k (exceeds 750k cap)");
    
    // Withdraw within cap (400,000 < 750,000)
    let result = pic.update_call(
        canister_id,
        dev,
        "withdraw_phase_funds",
        encode_one(400_000u128).unwrap(),
    )
    .expect("withdraw_phase_funds call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("withdraw_phase_funds returned error");
    
    let state_bytes = pic.query_call(
        canister_id,
        dev,
        "get_state",
        encode_one(()).unwrap(),
    )
    .unwrap();
    
    let state: cornerstone_core::ProjectState = candid::decode_one(&state_bytes).unwrap();
    assert_eq!(state.total_dev_withdrawn, 400_000);
}

#[test]
fn test_refund_after_deadline() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user = create_principal(2);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    // First create a canister to get the actual PocketIC time
    let temp_canister = pic.create_canister();
    pic.add_cycles(temp_canister, 1_000_000_000_000);
    
    let temp_params = default_params();
    let temp_init = project_canister::InitArgs {
        params: temp_params,
        owner: dev,
    };
    
    pic.install_canister(temp_canister, wasm.clone(), encode_one(temp_init).unwrap(), None);
    
    // Get the creation timestamp
    let state_bytes = pic.query_call(
        temp_canister,
        dev,
        "get_state",
        encode_one(()).unwrap(),
    )
    .unwrap();
    
    let temp_state: cornerstone_core::ProjectState = candid::decode_one(&state_bytes).unwrap();
    let current_time = temp_state.last_accrual_ts;
    
    // Now create the actual test canister with a deadline in the future
    let mut params = default_params();
    params.fundraise_deadline = current_time + 1000; // 1000 seconds from now
    params.min_raise = 1_000_000; // Set high enough that 100k won't meet it
    
    let init_args = project_canister::InitArgs {
        params,
        owner: dev,
    };
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposit less than minimum (while still before deadline)
    let result = pic.update_call(canister_id, user, "deposit", encode_one(100_000u128).unwrap())
        .expect("deposit call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("deposit returned error");
    
    // Advance time past the deadline
    pic.advance_time(Duration::from_secs(1100));
    
    // Request refund
    let refund_result = pic.update_call(
        canister_id,
        user,
        "refund_if_min_not_met",
        encode_one(()).unwrap(),
    )
    .expect("refund_if_min_not_met call failed");
    
    let refunded: Result<u128, String> = 
        candid::decode_one(&refund_result).unwrap();
    assert_eq!(refunded.unwrap(), 100_000);
    
    let state_bytes = pic.query_call(
        canister_id,
        dev,
        "get_state",
        encode_one(()).unwrap(),
    )
    .unwrap();
    
    let state: cornerstone_core::ProjectState = candid::decode_one(&state_bytes).unwrap();
    assert_eq!(state.total_raised, 0);
    assert_eq!(state.total_supply, 0);
}

#[test]
fn test_pause_and_unpause_flow() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user = create_principal(2);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = project_canister::InitArgs {
        params: default_params(),
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Pause as dev
    let result = pic.update_call(canister_id, dev, "pause", encode_one(()).unwrap())
        .expect("pause call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("pause returned error");
    
    // Try to deposit while paused (should fail)
    let result = pic.update_call(
        canister_id,
        user,
        "deposit",
        encode_one(100_000u128).unwrap(),
    )
    .expect("deposit call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    assert!(response.is_err());
    
    // Unpause
    let result = pic.update_call(canister_id, dev, "unpause", encode_one(()).unwrap())
        .expect("unpause call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("unpause returned error");
    
    // Deposit should work now
    let result = pic.update_call(canister_id, user, "deposit", encode_one(100_000u128).unwrap())
        .expect("deposit call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("deposit returned error");
}

#[test]
fn test_transfer_shares() {
    let pic = PocketIc::new();
    let dev = create_principal(1);
    let user1 = create_principal(2);
    let user2 = create_principal(3);
    
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = project_canister::InitArgs {
        params: default_params(),
        owner: dev,
    };
    
    let wasm = std::fs::read("target/wasm32-unknown-unknown/release/project_canister.wasm")
        .expect("Wasm file not found");
    
    pic.install_canister(canister_id, wasm, encode_one(init_args).unwrap(), None);
    
    // Deposit as user1
    let result = pic.update_call(canister_id, user1, "deposit", encode_one(1_000_000u128).unwrap())
        .expect("deposit call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("deposit returned error");
    
    // Transfer half to user2
    let result = pic.update_call(
        canister_id,
        user1,
        "transfer_shares",
        candid::encode_args((user2, 500_000u128)).unwrap(),
    )
    .expect("transfer_shares call failed");
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("transfer_shares returned error");
    
    let state_bytes = pic.query_call(
        canister_id,
        dev,
        "get_state",
        encode_one(()).unwrap(),
    )
    .unwrap();
    
    let state: cornerstone_core::ProjectState = candid::decode_one(&state_bytes).unwrap();
    
    let balance1 = state.accounts.get(&user1).map(|a| a.balance).unwrap_or(0);
    let balance2 = state.accounts.get(&user2).map(|a| a.balance).unwrap_or(0);
    
    assert_eq!(balance1, 500_000);
    assert_eq!(balance2, 500_000);
}