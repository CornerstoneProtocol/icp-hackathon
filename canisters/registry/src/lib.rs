use candid::{CandidType, Encode, Principal};
use cornerstone_core::{ProjectError, ProjectListing, ProjectParams, RegistryState, Timestamp};
use ic_cdk::api::management_canister::main::{
    create_canister, install_code, CanisterInstallMode, CanisterSettings, CreateCanisterArgument,
    InstallCodeArgument,
};
use ic_cdk::api::time;
use ic_cdk::caller;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

thread_local! {
    static REGISTRY: RefCell<Option<RegistryState>> = const { RefCell::new(None) };
    static PROJECT_WASM: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
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

#[ic_cdk::post_upgrade]
fn post_upgrade() {
    // After upgrade, ensure registry is initialized if not already
    REGISTRY.with(|cell| {
        if cell.borrow().is_none() {
            let owner = caller();
            *cell.borrow_mut() = Some(RegistryState::new(owner));
        }
    });
}

fn map_err(err: ProjectError) -> String {
    err.to_string()
}

// Initialize args for project canister
#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
struct ProjectInitArgs {
    params: ProjectParams,
    owner: Principal,
}

// Helper function to create and initialize a project canister
async fn create_project_canister(
    creator: Principal,
    params: ProjectParams,
) -> Result<Principal, String> {
    // Get the WASM module
    let wasm_module = PROJECT_WASM.with(|w| w.borrow().clone());

    if wasm_module.is_empty() {
        return Err("Project WASM not set".to_string());
    }

    // Create canister with the creator as controller
    let create_args = CreateCanisterArgument {
        settings: Some(CanisterSettings {
            controllers: Some(vec![ic_cdk::id(), creator]),
            compute_allocation: None,
            memory_allocation: None,
            freezing_threshold: None,
            reserved_cycles_limit: None,
        }),
    };

    let (canister_id,) = create_canister(create_args, 1_000_000_000_000u128)
        .await
        .map_err(|e| format!("Failed to create canister: {:?}", e))?;

    // Prepare init args
    let init_args = ProjectInitArgs { params, owner: creator };
    let encoded_args = Encode!(&init_args).map_err(|e| format!("Failed to encode args: {:?}", e))?;

    // Install code
    let install_args = InstallCodeArgument {
        mode: CanisterInstallMode::Install,
        canister_id: canister_id.canister_id,
        wasm_module,
        arg: encoded_args,
    };

    install_code(install_args)
        .await
        .map_err(|e| format!("Failed to install code: {:?}", e))?;

    Ok(canister_id.canister_id)
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
async fn register_project(params: ProjectParams, metadata_uri: String) -> Result<ProjectListing, String> {
    let caller = caller();
    let now = now();

    // Clone params for canister creation
    let params_clone = params.clone();

    // Create the project canister
    let project_canister = create_project_canister(caller, params_clone)
        .await
        .map_err(|e| format!("Failed to create project canister: {}", e))?;

    // For now, we don't create a separate token canister since shares are managed in the project
    let token_canister = project_canister; // Shares are managed within project

    // Register in state with canister IDs
    let mut listing = with_registry_mut(|state|
        state.register_project(&caller, params, metadata_uri, now)
    );

    // Assign the canister IDs
    listing.project_canister = Some(project_canister);
    listing.token_canister = Some(token_canister);

    // Update in registry
    with_registry_mut(|state| {
        if let Some(existing) = state.listings.iter_mut().find(|l| l.id == listing.id) {
            existing.project_canister = Some(project_canister);
            existing.token_canister = Some(token_canister);
        }
    });

    Ok(listing)
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

/// Set the project WASM module (owner only)
#[ic_cdk::update]
fn set_project_wasm(wasm_module: serde_bytes::ByteBuf) -> Result<(), String> {
    let wasm_module: Vec<u8> = wasm_module.into_vec();
    let caller = caller();

    // Check if caller is owner
    with_registry(|state| {
        if state.owner != caller {
            return Err("Only owner can set WASM".to_string());
        }
        Ok(())
    })?;

    if wasm_module.is_empty() {
        return Err("WASM module is empty".to_string());
    }

    // Verify it's a valid WASM module (basic check - starts with magic number)
    if wasm_module.len() < 4 || &wasm_module[0..4] != b"\0asm" {
        return Err("Invalid WASM module - missing magic number".to_string());
    }

    PROJECT_WASM.with(|w| {
        *w.borrow_mut() = wasm_module;
    });

    Ok(())
}

/// Get the size of the stored project WASM (for verification)
#[ic_cdk::query]
fn get_project_wasm_size() -> u64 {
    PROJECT_WASM.with(|w| w.borrow().len() as u64)
}

ic_cdk::export_candid!();
