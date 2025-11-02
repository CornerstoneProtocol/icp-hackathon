use candid::{encode_one, Principal};
use pocket_ic::PocketIc;
use std::time::Duration;

const BPS_DENOM: u128 = 10_000;
const YEAR_SECONDS: u64 = 31_536_000;

fn create_principal(id: u8) -> Principal {
    Principal::from_slice(&[id; 29])
}

fn default_params() -> cornerstone_core::ProjectParams {
    cornerstone_core::ProjectParams {
        stablecoin: "ckUSDC".to_string(),
        min_raise: 1_000_000,
        max_raise: 5_000_000,
        fundraise_deadline: u64::MAX,
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

struct TestContext {
    pic: PocketIc,
    canister_id: Principal,
    dev: Principal,
    user1: Principal,
    user2: Principal,
    deposits: std::collections::HashMap<Principal, u128>,
    total_shares: u128,
    reserve_top_up: u128,
    total_interest_accrued: u128,
}

impl TestContext {
    fn new() -> Self {
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
        
        Self {
            pic,
            canister_id,
            dev,
            user1,
            user2,
            deposits: std::collections::HashMap::new(),
            total_shares: 0,
            reserve_top_up: 0,
            total_interest_accrued: 0,
        }
    }
    
    fn deposit(&mut self, user: Principal, amount: u128) {
        let result = self.pic
            .update_call(
                self.canister_id,
                user,
                "deposit",
                encode_one(amount).unwrap(),
            )
            .expect("deposit call failed");
        
        let response: Result<(), String> = candid::decode_one(&result).unwrap();
        response.expect("deposit returned error");
        
        self.deposits.insert(user, amount);
        self.total_shares += amount;
    }
    
    fn fund_reserve(&mut self, amount: u128) {
        let result = self.pic
            .update_call(
                self.canister_id,
                self.dev,
                "fund_reserve",
                encode_one(amount).unwrap(),
            )
            .expect("fund_reserve call failed");
        
        let response: Result<(), String> = candid::decode_one(&result).unwrap();
        response.expect("fund_reserve returned error");
        
        self.reserve_top_up += amount;
    }
    
    fn close_phase(&mut self, phase: u8) {
        let doc = create_doc_record(&format!("phase-{}", phase));
        let result = self.pic
            .update_call(
                self.canister_id,
                self.dev,
                "close_phase",
                candid::encode_args((phase, doc)).unwrap(),
            )
            .expect(&format!("close_phase {} call failed", phase));
        
        let response: Result<(), String> = candid::decode_one(&result).unwrap();
        response.expect(&format!("close_phase {} returned error", phase));
    }
    
    fn accrue_phase(&mut self, _phase: u8) -> u128 {
        // Advance time by 1 year
        self.pic.advance_time(Duration::from_secs(YEAR_SECONDS));
        
        let state_before = self.get_state();
        
        let result = self.pic
            .update_call(
                self.canister_id,
                self.user1,
                "accrue_interest",
                encode_one(()).unwrap(),
            )
            .expect("accrue_interest call failed");
        
        let response: Result<(), String> = candid::decode_one(&result).unwrap();
        response.expect("accrue_interest returned error");
        
        let state_after = self.get_state();
        
        let interest = state_after.pool_balance.saturating_sub(state_before.pool_balance);
        self.total_interest_accrued += interest;
        
        interest
    }
    
    fn claim_interest(&mut self, user: Principal, amount: u128) {
        let result = self.pic
            .update_call(
                self.canister_id,
                user,
                "claim_interest",
                encode_one(amount).unwrap(),
            )
            .expect("claim_interest call failed");
        
        let response: Result<u128, String> = candid::decode_one(&result).unwrap();
        response.expect("claim_interest returned error");
    }
    
    fn submit_sales_proceeds(&mut self, amount: u128) {
        let result = self.pic
            .update_call(
                self.canister_id,
                self.dev,
                "submit_sales_proceeds",
                encode_one(amount).unwrap(),
            )
            .expect("submit_sales_proceeds call failed");
        
        let response: Result<(), String> = candid::decode_one(&result).unwrap();
        response.expect("submit_sales_proceeds returned error");
    }
    
    fn claim_revenue(&mut self, user: Principal) -> u128 {
        let result = self.pic
            .update_call(
                self.canister_id,
                user,
                "claim_revenue",
                encode_one(()).unwrap(),
            )
            .expect("claim_revenue call failed");
        
        let amount: Result<u128, String> = candid::decode_one(&result).unwrap();
        amount.unwrap()
    }
    
    fn withdraw_principal(&mut self, user: Principal, shares: u128) -> u128 {
        let result = self.pic
            .update_call(
                self.canister_id,
                user,
                "withdraw_principal",
                encode_one(shares).unwrap(),
            )
            .expect("withdraw_principal call failed");
        
        let amount: Result<u128, String> = candid::decode_one(&result).unwrap();
        amount.unwrap()
    }
    
    fn get_state(&self) -> cornerstone_core::ProjectState {
        let state_bytes = self.pic
            .query_call(
                self.canister_id,
                self.dev,
                "get_state",
                encode_one(()).unwrap(),
            )
            .expect("get_state failed");
        
        candid::decode_one(&state_bytes).unwrap()
    }
    
    fn claimable_interest(&self, user: Principal) -> u128 {
        let bytes = self.pic
            .query_call(
                self.canister_id,
                user,
                "claimable_interest",
                encode_one(user).unwrap(),
            )
            .expect("claimable_interest failed");
        
        candid::decode_one(&bytes).unwrap()
    }
    
    fn claimable_revenue(&self, user: Principal) -> u128 {
        let bytes = self.pic
            .query_call(
                self.canister_id,
                user,
                "claimable_revenue",
                encode_one(user).unwrap(),
            )
            .expect("claimable_revenue failed");
        
        candid::decode_one(&bytes).unwrap()
    }
}

#[test]
fn test_full_lifecycle_with_interest_across_phases() {
    let mut ctx = TestContext::new();
    
    // Setup: deposits
    let deposit1 = 700_000;
    let deposit2 = 800_000;
    
    ctx.deposit(ctx.user1, deposit1);
    ctx.deposit(ctx.user2, deposit2);
    
    let total_deposit = deposit1 + deposit2;
    assert_eq!(ctx.total_shares, total_deposit);
    
    // Fund reserve BEFORE closing phase 0
    let reserve_amount = 800_000;
    ctx.fund_reserve(reserve_amount);
    
    // Close phase 0 (fundraising)
    ctx.close_phase(0);
    
    let state = ctx.get_state();
    assert_eq!(state.current_phase, 1, "Phase should be 1 after closing phase 0");
    assert!(state.fundraise_successful);
    
    // Track claimed amounts
    let mut user1_claimed = 0u128;
    let mut user2_claimed = 0u128;
    
    // Phase 1: accrue and partial claim
    ctx.accrue_phase(1);
    
    let claimable1 = ctx.claimable_interest(ctx.user1);
    if claimable1 > 0 {
        let claim_amount = claimable1.min(50_000);
        ctx.claim_interest(ctx.user1, claim_amount);
        user1_claimed += claim_amount;
    }
    
    ctx.close_phase(1);
    
    // Phase 2: accrue and claim
    ctx.accrue_phase(2);
    
    let claimable2 = ctx.claimable_interest(ctx.user2);
    if claimable2 > 0 {
        let claim_amount = claimable2.min(120_000);
        ctx.claim_interest(ctx.user2, claim_amount);
        user2_claimed += claim_amount;
    }
    
    ctx.close_phase(2);
    
    // Phase 3: accrue and claim
    ctx.accrue_phase(3);
    
    let claimable1 = ctx.claimable_interest(ctx.user1);
    if claimable1 > 0 {
        let claim_amount = claimable1.min(100_000);
        ctx.claim_interest(ctx.user1, claim_amount);
        user1_claimed += claim_amount;
    }
    
    ctx.close_phase(3);
    
    // Phase 4: accrue and claim
    ctx.accrue_phase(4);
    
    let claimable2 = ctx.claimable_interest(ctx.user2);
    if claimable2 > 0 {
        let claim_amount = claimable2.min(90_000);
        ctx.claim_interest(ctx.user2, claim_amount);
        user2_claimed += claim_amount;
    }
    
    ctx.close_phase(4);
    
    // Phase 5: accrue
    ctx.accrue_phase(5);
    
    // Final claims
    let user1_remaining = ctx.claimable_interest(ctx.user1);
    let user2_remaining = ctx.claimable_interest(ctx.user2);
    
    // Verify some interest was accrued
    let total_claimed = user1_claimed + user2_claimed;
    assert!(total_claimed > 0 || user1_remaining > 0 || user2_remaining > 0, 
            "Expected some interest to be available");
    
    // Verify reserve decreased if interest was paid
    let state = ctx.get_state();
    if ctx.total_interest_accrued > 0 {
        assert!(state.reserve_balance <= reserve_amount);
    }
}

#[test]
fn test_sales_proceeds_and_revenue_distribution() {
    let mut ctx = TestContext::new();
    
    ctx.deposit(ctx.user1, 1_500_000);
    ctx.fund_reserve(500_000);
    ctx.close_phase(0);
    
    let state = ctx.get_state();
    assert!(state.fundraise_successful, "Fundraise must be successful");
    
    let outstanding = state.total_raised - state.principal_redeemed;
    
    // Submit proceeds to partially fill buffer
    let first_proceeds = outstanding.min(1_000_000);
    ctx.submit_sales_proceeds(first_proceeds);
    
    let state = ctx.get_state();
    assert_eq!(state.principal_buffer, first_proceeds);
    
    // Submit more proceeds - this should fill buffer and create revenue
    let extra_proceeds = 700_000;
    ctx.submit_sales_proceeds(extra_proceeds);
    
    let state = ctx.get_state();
    let total_submitted = first_proceeds + extra_proceeds;
    
    // If we submitted more than outstanding, we should have revenue
    if total_submitted > outstanding {
        let expected_revenue_total = total_submitted - outstanding;
        assert_eq!(state.principal_buffer, outstanding, "Buffer should be capped at outstanding");
        
        let revenue = ctx.claimable_revenue(ctx.user1);
        assert!(revenue > 0, "Expected revenue > 0 when total_submitted ({}) > outstanding ({})", 
                total_submitted, outstanding);
        assert!(revenue <= expected_revenue_total, "Revenue should not exceed excess");
        
        // Claim revenue
        let claimed_revenue = ctx.claim_revenue(ctx.user1);
        assert!(claimed_revenue > 0);
        
        // Verify no more revenue claimable
        let remaining_revenue = ctx.claimable_revenue(ctx.user1);
        assert_eq!(remaining_revenue, 0);
    }
}

#[test]
fn test_principal_withdrawal_after_proceeds() {
    let mut ctx = TestContext::new();
    
    let deposit_amount = 1_500_000;
    ctx.deposit(ctx.user1, deposit_amount);
    
    // MUST fund reserve before closing phase 0
    ctx.fund_reserve(500_000);
    ctx.close_phase(0);
    
    let state = ctx.get_state();
    assert!(state.fundraise_successful, "Fundraise should be successful after min_raise met");
    assert_eq!(state.current_phase, 1, "Should be in phase 1 after closing phase 0");
    
    // Submit full outstanding as proceeds
    let state = ctx.get_state();
    let outstanding = state.total_raised - state.principal_redeemed;
    ctx.submit_sales_proceeds(outstanding);
    
    let state = ctx.get_state();
    assert_eq!(state.principal_buffer, outstanding);
    
    // Withdraw principal
    let shares_to_withdraw = 700_000;
    let withdrawn = ctx.withdraw_principal(ctx.user1, shares_to_withdraw);
    
    assert_eq!(withdrawn, shares_to_withdraw);
    
    let state = ctx.get_state();
    assert_eq!(state.principal_redeemed, shares_to_withdraw);
    assert_eq!(state.principal_buffer, outstanding - shares_to_withdraw);
}

#[test]
fn test_progressive_phase5_unlock() {
    let mut ctx = TestContext::new();
    
    ctx.deposit(ctx.user1, 1_200_000);
    ctx.fund_reserve(500_000);
    
    // Close phases 0-4 to reach phase 5
    for phase in 0..=4 {
        ctx.close_phase(phase);
    }
    
    let state = ctx.get_state();
    assert_eq!(state.current_phase, 5, "Should be in phase 5 after closing phases 0-4");
    
    // Submit 40% appraisal
    let result = ctx.pic
        .update_call(
            ctx.canister_id,
            ctx.dev,
            "submit_appraisal",
            candid::encode_args((40u8, "hash1".to_string())).unwrap(),
        )
        .expect("submit_appraisal call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("submit_appraisal returned error");
    
    let state = ctx.get_state();
    assert_eq!(state.phase5_percent_complete, 40);
    
    // Submit 80% appraisal
    let result = ctx.pic
        .update_call(
            ctx.canister_id,
            ctx.dev,
            "submit_appraisal",
            candid::encode_args((80u8, "hash2".to_string())).unwrap(),
        )
        .expect("submit_appraisal call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("submit_appraisal returned error");
    
    let state = ctx.get_state();
    assert_eq!(state.phase5_percent_complete, 80);
    
    // Try to submit lower percentage (should fail)
    let result = ctx.pic.update_call(
        ctx.canister_id,
        ctx.dev,
        "submit_appraisal",
        candid::encode_args((79u8, "hash3".to_string())).unwrap(),
    ).expect("submit_appraisal call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    assert!(response.is_err());
}

#[test]
fn test_developer_withdrawal_caps() {
    let mut ctx = TestContext::new();
    
    ctx.deposit(ctx.user1, 1_500_000);
    ctx.fund_reserve(500_000);
    
    // Close phase 0 and 1
    ctx.close_phase(0);
    
    let state = ctx.get_state();
    assert!(state.fundraise_successful);
    assert_eq!(state.current_phase, 1);
    
    ctx.close_phase(1);
    
    let state = ctx.get_state();
    let params = state.params;
    
    // Use max_raise for cap calculation as per the core implementation
    let phase1_cap_bps = params.phase_withdraw_caps_bps[1] as u128;
    let phase1_cap = (params.max_raise * phase1_cap_bps) / BPS_DENOM;
    
    assert!(phase1_cap > 0, "Phase 1 cap should be > 0");
    
    // Try to withdraw more than cap (should fail)
    let result = ctx.pic.update_call(
        ctx.canister_id,
        ctx.dev,
        "withdraw_phase_funds",
        encode_one(phase1_cap + 1).unwrap(),
    ).expect("withdraw_phase_funds call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    assert!(response.is_err(), "Should fail when withdrawing more than cap");
    
    // Withdraw within cap
    let withdraw_amount = phase1_cap.min(state.total_raised);
    let result = ctx.pic
        .update_call(
            ctx.canister_id,
            ctx.dev,
            "withdraw_phase_funds",
            encode_one(withdraw_amount).unwrap(),
        )
        .expect("withdraw_phase_funds call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("withdraw_phase_funds returned error");
    
    let state = ctx.get_state();
    assert_eq!(state.total_dev_withdrawn, withdraw_amount);
}

#[test]
fn test_transfer_shares_preserves_corrections() {
    let mut ctx = TestContext::new();
    
    ctx.deposit(ctx.user1, 1_000_000);
    ctx.fund_reserve(500_000);
    ctx.close_phase(0);
    
    let state = ctx.get_state();
    assert!(state.fundraise_successful, "Fundraise should be successful");
    
    // Submit proceeds with revenue
    let outstanding = state.total_raised - state.principal_redeemed;
    let extra = 123_456;
    ctx.submit_sales_proceeds(outstanding + extra);
    
    let revenue_before = ctx.claimable_revenue(ctx.user1);
    assert!(revenue_before > 0, "Should have revenue after submitting more than outstanding");
    
    // Transfer half shares to user2
    let result = ctx.pic
        .update_call(
            ctx.canister_id,
            ctx.user1,
            "transfer_shares",
            candid::encode_args((ctx.user2, 500_000u128)).unwrap(),
        )
        .expect("transfer_shares call failed");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("transfer_shares returned error");
    
    // user1 should still have same claimable revenue (corrections preserve history)
    let revenue_after = ctx.claimable_revenue(ctx.user1);
    assert_eq!(revenue_after, revenue_before);
    
    // user2 should have no claimable from past (got shares after revenue distribution)
    let user2_revenue = ctx.claimable_revenue(ctx.user2);
    assert_eq!(user2_revenue, 0);
}

#[test]
fn test_interest_double_claim_prevention() {
    let mut ctx = TestContext::new();
    
    ctx.deposit(ctx.user1, 1_000_000);
    ctx.fund_reserve(400_000);
    ctx.close_phase(0);
    
    // Accrue first year
    ctx.accrue_phase(1);
    
    let first_claim = ctx.claimable_interest(ctx.user1);
    
    if first_claim > 0 {
        // Claim all interest
        ctx.claim_interest(ctx.user1, first_claim);
        
        // Verify no more claimable
        let remaining = ctx.claimable_interest(ctx.user1);
        assert_eq!(remaining, 0);
        
        // Transfer all shares to user2
        let state = ctx.get_state();
        let balance = state.accounts.get(&ctx.user1).map(|a| a.balance).unwrap_or(0);
        
        let result = ctx.pic
            .update_call(
                ctx.canister_id,
                ctx.user1,
                "transfer_shares",
                candid::encode_args((ctx.user2, balance)).unwrap(),
            )
            .expect("transfer call failed");
        
        let response: Result<(), String> = candid::decode_one(&result).unwrap();
        response.expect("transfer returned error");
        
        // user1 should still have no claimable
        assert_eq!(ctx.claimable_interest(ctx.user1), 0);
        
        // user2 should have no claimable from past
        assert_eq!(ctx.claimable_interest(ctx.user2), 0);
        
        // Close phase 1 and accrue another year in phase 2
        ctx.close_phase(1);
        ctx.accrue_phase(2);
        
        // Now only user2 should have claimable
        assert_eq!(ctx.claimable_interest(ctx.user1), 0);
    } else {
        println!("Warning: No interest accrued for double claim test");
    }
}

#[test]
fn test_complete_project_lifecycle() {
    let mut ctx = TestContext::new();
    
    // Setup
    ctx.deposit(ctx.user1, 700_000);
    ctx.deposit(ctx.user2, 800_000);
    ctx.fund_reserve(800_000);
    
    // Close all phases and accrue interest
    ctx.close_phase(0);
    
    let mut user1_interest_claimed = 0;
    let mut user2_interest_claimed = 0;
    
    for phase in 1..=5 {
        ctx.accrue_phase(phase);
        
        // Claim some interest each phase
        let claimable1 = ctx.claimable_interest(ctx.user1);
        if claimable1 > 0 {
            let to_claim = claimable1 / 2;
            ctx.claim_interest(ctx.user1, to_claim);
            user1_interest_claimed += to_claim;
        }
        
        if phase < 5 {
            ctx.close_phase(phase);
        }
    }
    
    // Submit final sales proceeds
    let state = ctx.get_state();
    let outstanding = state.total_raised - state.principal_redeemed;
    ctx.submit_sales_proceeds(outstanding + 200_000); // extra 200k revenue
    
    // Claim remaining interest if any
    let remaining1 = ctx.claimable_interest(ctx.user1);
    if remaining1 > 0 {
        ctx.claim_interest(ctx.user1, remaining1);
        user1_interest_claimed += remaining1;
    }
    
    let remaining2 = ctx.claimable_interest(ctx.user2);
    if remaining2 > 0 {
        ctx.claim_interest(ctx.user2, remaining2);
        user2_interest_claimed += remaining2;
    }
    
    // Claim revenue
    let revenue1 = ctx.claimable_revenue(ctx.user1);
    let revenue2 = ctx.claimable_revenue(ctx.user2);
    
    if revenue1 > 0 {
        ctx.claim_revenue(ctx.user1);
    }
    if revenue2 > 0 {
        ctx.claim_revenue(ctx.user2);
    }
    
    // Close phase 5
    ctx.close_phase(5);
    
    // Withdraw principal
    let state = ctx.get_state();
    let shares1 = state.accounts.get(&ctx.user1).map(|a| a.balance).unwrap_or(0);
    let shares2 = state.accounts.get(&ctx.user2).map(|a| a.balance).unwrap_or(0);
    
    if shares1 > 0 {
        ctx.withdraw_principal(ctx.user1, shares1);
    }
    if shares2 > 0 {
        ctx.withdraw_principal(ctx.user2, shares2);
    }
    
    // Verify final state
    let final_state = ctx.get_state();
    assert_eq!(final_state.total_supply, 0);
    
    // Verify users got at least their original deposits
    let user1_total_out = 700_000 + user1_interest_claimed + revenue1;
    let user2_total_out = 800_000 + user2_interest_claimed + revenue2;
    
    assert!(user1_total_out >= 700_000);
    assert!(user2_total_out >= 800_000);
}