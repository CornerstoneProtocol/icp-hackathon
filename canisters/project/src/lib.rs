use candid::{CandidType, Principal};
use cornerstone_core::{Amount, DocRecord, ProjectError, ProjectParams, ProjectState, Timestamp};
use ic_cdk::api::time;
use ic_cdk::caller;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

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

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct InitArgs {
    pub params: ProjectParams,
}

#[ic_cdk::init]
fn init(args: InitArgs) {
    let owner = caller();
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
fn claimable_interest(principal: Principal) -> Amount {
    with_state(|state| state.claimable_interest(&principal))
}

#[ic_cdk::query]
fn claimable_revenue(principal: Principal) -> Amount {
    with_state(|state| state.claimable_revenue(&principal))
}

#[ic_cdk::update]
fn deposit(amount: Amount) -> Result<(), String> {
    let caller = caller();
    let now = now();
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
fn withdraw_phase_funds(amount: Amount) -> Result<(), String> {
    let caller = caller();
    let now = now();
    with_state_mut(|state| state.withdraw_phase_funds(&caller, amount, now)).map_err(map_err)
}

#[ic_cdk::update]
fn fund_reserve(amount: Amount) -> Result<(), String> {
    let caller = caller();
    with_state_mut(|state| state.fund_reserve(&caller, amount)).map_err(map_err)
}

#[ic_cdk::update]
fn submit_sales_proceeds(amount: Amount) -> Result<(), String> {
    let caller = caller();
    let now = now();
    with_state_mut(|state| state.submit_sales_proceeds(&caller, amount, now)).map_err(map_err)
}

#[ic_cdk::update]
fn claim_interest(amount: Amount) -> Result<Amount, String> {
    let caller = caller();
    let now = now();
    with_state_mut(|state| state.claim_interest(&caller, amount, now)).map_err(map_err)
}

#[ic_cdk::update]
fn claim_revenue() -> Result<Amount, String> {
    let caller = caller();
    let now = now();
    with_state_mut(|state| state.claim_revenue(&caller, now)).map_err(map_err)
}

#[ic_cdk::update]
fn withdraw_principal(shares: Amount) -> Result<Amount, String> {
    let caller = caller();
    let now = now();
    with_state_mut(|state| state.withdraw_principal(&caller, shares, now)).map_err(map_err)
}

#[ic_cdk::update]
fn refund_if_min_not_met() -> Result<Amount, String> {
    let caller = caller();
    let now = now();
    with_state_mut(|state| state.refund_if_min_not_met(&caller, now)).map_err(map_err)
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
