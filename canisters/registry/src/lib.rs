use candid::{CandidType, Principal};
use cornerstone_core::{ProjectError, ProjectListing, ProjectParams, RegistryState, Timestamp};
use ic_cdk::api::time;
use ic_cdk::caller;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

thread_local! {
    static REGISTRY: RefCell<Option<RegistryState>> = const { RefCell::new(None) };
}

fn now() -> Timestamp {
    time() / 1_000_000_000
}

fn with_registry<R>(f: impl FnOnce(&RegistryState) -> R) -> R {
    REGISTRY.with(|cell| {
        let borrow = cell.borrow();
        let state = borrow.as_ref().expect("registry not initialized");
        f(state)
    })
}

fn with_registry_mut<R>(f: impl FnOnce(&mut RegistryState) -> R) -> R {
    REGISTRY.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let state = borrow.as_mut().expect("registry not initialized");
        f(state)
    })
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
pub struct InitArgs {
    pub owner: Option<Principal>,
}

#[ic_cdk::init]
fn init(args: Option<InitArgs>) {
    let explicit_owner = args.and_then(|a| a.owner);
    let owner = explicit_owner.unwrap_or_else(caller);
    REGISTRY.with(|cell| {
        *cell.borrow_mut() = Some(RegistryState::new(owner));
    });
}

fn map_err(err: ProjectError) -> String {
    err.to_string()
}

#[ic_cdk::query]
fn list_projects() -> Vec<ProjectListing> {
    with_registry(|state| state.list())
}

#[ic_cdk::query]
fn get_project(id: u64) -> Option<ProjectListing> {
    with_registry(|state| state.get(id))
}

#[ic_cdk::update]
fn register_project(params: ProjectParams, metadata_uri: String) -> ProjectListing {
    let caller = caller();
    let now = now();
    with_registry_mut(|state| state.register_project(&caller, params, metadata_uri, now))
}

#[ic_cdk::update]
fn assign_canisters(
    id: u64,
    project_canister: Principal,
    token_canister: Principal,
) -> Result<(), String> {
    let caller = caller();
    with_registry_mut(|state| state.assign_canisters(&caller, id, project_canister, token_canister))
        .map_err(map_err)
}

ic_cdk::export_candid!();
