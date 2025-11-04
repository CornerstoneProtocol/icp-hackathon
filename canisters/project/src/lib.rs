use candid::{CandidType, Nat, Principal};
use cornerstone_core::{Amount, DocRecord, ProjectError, ProjectParams, ProjectState, Timestamp};
use ic_cdk::api::{time, call::call};
use ic_cdk::caller;
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

fn ledger_canister_id() -> &'static str {
    option_env!("CKBTC_LEDGER_CANISTER_ID").unwrap_or("twxf4-i7777-77774-qaaqq-cai")
}

fn ledger_principal() -> Result<Principal, String> {
    Principal::from_text(ledger_canister_id())
        .map_err(|e| format!("Invalid ledger principal: {:?}", e))
}

#[derive(CandidType, Clone, Debug, Deserialize, Serialize)]
pub struct Account {
    pub owner: Principal,
    pub subaccount: Option<Vec<u8>>,
}

#[derive(CandidType, Clone, Debug, Deserialize, Serialize)]
pub struct TransferArg {
    pub from_subaccount: Option<Vec<u8>>,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Clone, Debug, Deserialize, Serialize)]
pub struct TransferFromArg {
    pub spender_subaccount: Option<Vec<u8>>,
    pub from: Account,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Clone, Debug, Deserialize, Serialize)]
pub enum TransferError {
    BadFee { expected_fee: Nat },
    BadBurn { min_burn_amount: Nat },
    InsufficientFunds { balance: Nat },
    TooOld,
    CreatedInFuture { ledger_time: u64 },
    Duplicate { duplicate_of: Nat },
    TemporarilyUnavailable,
    GenericError { error_code: Nat, message: String },
}

pub type TransferResult = Result<Nat, TransferError>;

thread_local! {
    static STATE: RefCell<Option<ProjectState>> = const { RefCell::new(None) };
}

fn now() -> Timestamp {
    time() / 1_000_000_000
}

fn with_state<R>(f: impl FnOnce(&ProjectState) -> R) -> R {
    STATE.with(|s| {
        let borrow = s.borrow();
        let state = borrow.as_ref().expect("project not initialized");
        f(state)
    })
}

fn with_state_mut<R>(f: impl FnOnce(&mut ProjectState) -> R) -> R {
    STATE.with(|s| {
        let mut borrow = s.borrow_mut();
        let state = borrow.as_mut().expect("project not initialized");
        f(state)
    })
}

async fn transfer_ckbtc(to: Principal, amount: Amount) -> Result<Nat, String> {
    let ledger_id = ledger_principal()?;
    
    let transfer_arg = TransferArg {
        from_subaccount: None,
        to: Account {
            owner: to,
            subaccount: None,
        },
        amount: Nat::from(amount),
        fee: None,
        memo: None,
        created_at_time: Some(ic_cdk::api::time()),
    };

    let (result,): (TransferResult,) = call(
        ledger_id,
        "icrc1_transfer",
        (transfer_arg,)
    )
    .await
    .map_err(|e| format!("Transfer call failed: {:?}", e))?;

    result.map_err(|e| format!("Transfer failed: {:?}", e))
}

async fn get_ckbtc_balance() -> Result<Amount, String> {
    let ledger_id = ledger_principal()?;
    
    let account = Account {
        owner: ic_cdk::id(),
        subaccount: None,
    };

    let (balance,): (Nat,) = call(
        ledger_id,
        "icrc1_balance_of",
        (account,)
    )
    .await
    .map_err(|e| format!("Balance call failed: {:?}", e))?;

    balance.0.to_u128()
        .ok_or_else(|| "Balance overflow".to_string())
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct InitArgs {
    pub params: ProjectParams,
    pub owner: Principal,
}

#[ic_cdk::init]
fn init(args: InitArgs) {
    let owner = args.owner;
    let ts = now();
    STATE.with(|s| {
        *s.borrow_mut() = Some(ProjectState::new(owner, args.params, ts));
    });
}

fn map_err(err: ProjectError) -> String {
    err.to_string()
}

#[ic_cdk::query]
fn get_state() -> ProjectState {
    with_state(|state| state.clone())
}

#[ic_cdk::query]
fn get_owner() -> Principal {
    with_state(|state| state.get_owner())
}

#[ic_cdk::query]
fn get_caller() -> Principal {
    caller()
}

#[ic_cdk::query]
fn get_ckbtc_ledger() -> String {
    ledger_canister_id().to_string()
}

#[ic_cdk::query]
fn claimable_interest(principal: Principal) -> Amount {
    with_state(|state| state.claimable_interest(&principal))
}

#[ic_cdk::query]
fn claimable_revenue(principal: Principal) -> Amount {
    with_state(|state| state.claimable_revenue(&principal))
}

// This would require the caller to first call:
// icrc2_approve on the ledger to approve this canister

#[ic_cdk::update]
async fn deposit(amount: Amount) -> Result<(), String> {
    let caller = caller();
    let now = now();

    let ledger_id = ledger_principal()?;

    // Use icrc2_transfer_from instead
    let transfer_from_arg = TransferFromArg {
        spender_subaccount: None,
        from: Account {
            owner: caller,
            subaccount: None,
        },
        to: Account {
            owner: ic_cdk::id(),
            subaccount: None,
        },
        amount: Nat::from(amount),
        fee: None,
        memo: None,
        created_at_time: None,
    };

    let (result,): (TransferResult,) = call(
        ledger_id,
        "icrc2_transfer_from",
        (transfer_from_arg,)
    )
    .await
    .map_err(|e| format!("Transfer call failed: {:?}", e))?;

    result.map_err(|e| format!("ckBTC transfer failed: {:?}", e))?;

    with_state_mut(|state| state.deposit(&caller, amount, now)).map_err(map_err)
}

#[ic_cdk::update]
fn close_phase(phase_id: u8, docs: DocRecord) -> Result<(), String> {
    let caller = caller();
    let now = now();
    with_state_mut(|state| state.close_phase(&caller, phase_id, docs, now)).map_err(map_err)
}

#[ic_cdk::update]
fn submit_appraisal(percent: u8, appraisal_hash: String) -> Result<(), String> {
    let caller = caller();
    let now = now();
    with_state_mut(|state| state.submit_appraisal(&caller, percent, appraisal_hash, now))
        .map_err(map_err)
}

#[ic_cdk::update]
async fn withdraw_phase_funds(amount: Amount) -> Result<(), String> {
    let caller = caller();
    let now = now();
    
    with_state_mut(|state| state.withdraw_phase_funds(&caller, amount, now))
        .map_err(map_err)?;
    
    transfer_ckbtc(caller, amount).await?;
    
    Ok(())
}

#[ic_cdk::update]
async fn fund_reserve(amount: Amount) -> Result<(), String> {
    let caller = caller();
    
    let ledger_id = ledger_principal()?;
    
    let transfer_arg = TransferArg {
        from_subaccount: None,
        to: Account {
            owner: ic_cdk::id(),
            subaccount: None,
        },
        amount: Nat::from(amount),
        fee: None,
        memo: Some(b"Reserve funding".to_vec()),
        created_at_time: Some(ic_cdk::api::time()),
    };

    let (result,): (TransferResult,) = call(
        ledger_id,
        "icrc1_transfer",
        (transfer_arg,)
    )
    .await
    .map_err(|e| format!("Transfer call failed: {:?}", e))?;

    result.map_err(|e| format!("ckBTC transfer failed: {:?}", e))?;
    
    with_state_mut(|state| state.fund_reserve(&caller, amount)).map_err(map_err)
}

#[ic_cdk::update]
async fn submit_sales_proceeds(amount: Amount) -> Result<(), String> {
    let caller = caller();
    let now = now();
    
    // Transfer ckBTC from caller to project canister
    let ledger_id = ledger_principal()?;
    
    let transfer_arg = TransferArg {
        from_subaccount: None,
        to: Account {
            owner: ic_cdk::id(),
            subaccount: None,
        },
        amount: Nat::from(amount),
        fee: None,
        memo: Some(b"Sales proceeds".to_vec()),
        created_at_time: Some(ic_cdk::api::time()),
    };

    let (result,): (TransferResult,) = call(
        ledger_id,
        "icrc1_transfer",
        (transfer_arg,)
    )
    .await
    .map_err(|e| format!("Transfer call failed: {:?}", e))?;

    result.map_err(|e| format!("ckBTC transfer failed: {:?}", e))?;
    
    with_state_mut(|state| state.submit_sales_proceeds(&caller, amount, now))
        .map_err(map_err)
}

#[ic_cdk::update]
async fn claim_interest(amount: Amount) -> Result<Amount, String> {
    let caller = caller();
    let now = now();
    
    let claimed = with_state_mut(|state| state.claim_interest(&caller, amount, now))
        .map_err(map_err)?;
    
    transfer_ckbtc(caller, claimed).await?;
    
    Ok(claimed)
}

#[ic_cdk::update]
async fn claim_revenue() -> Result<Amount, String> {
    let caller = caller();
    let now = now();
    
    let claimed = with_state_mut(|state| state.claim_revenue(&caller, now))
        .map_err(map_err)?;
    
    transfer_ckbtc(caller, claimed).await?;
    
    Ok(claimed)
}

#[ic_cdk::query]
async fn get_canister_ckbtc_balance() -> Result<Amount, String> {
    get_ckbtc_balance().await
}

#[ic_cdk::update]
async fn withdraw_principal(shares: Amount) -> Result<Amount, String> {
    let caller = caller();
    let now = now();
    
    let redeemed = with_state_mut(|state| state.withdraw_principal(&caller, shares, now))
        .map_err(map_err)?;
    
    transfer_ckbtc(caller, redeemed).await?;
    
    Ok(redeemed)
}

#[ic_cdk::update]
async fn refund_if_min_not_met() -> Result<Amount, String> {
    let caller = caller();
    let now = now();
    
    let refunded = with_state_mut(|state| state.refund_if_min_not_met(&caller, now))
        .map_err(map_err)?;
    
    transfer_ckbtc(caller, refunded).await?;
    
    Ok(refunded)
}

#[ic_cdk::update]
fn accrue_interest() -> Result<(), String> {
    let now = now();
    with_state_mut(|state| state.accrue_interest(now)).map_err(map_err)
}

#[ic_cdk::update]
fn pause() -> Result<(), String> {
    let caller = caller();
    with_state_mut(|state| state.pause(&caller)).map_err(map_err)
}

#[ic_cdk::update]
fn unpause() -> Result<(), String> {
    let caller = caller();
    with_state_mut(|state| state.unpause(&caller)).map_err(map_err)
}

#[ic_cdk::update]
fn transfer_shares(to: Principal, amount: Amount) -> Result<(), String> {
    let caller = caller();
    with_state_mut(|state| state.transfer_shares(&caller, &to, amount)).map_err(map_err)
}

ic_cdk::export_candid!();
