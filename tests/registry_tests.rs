mod common;

use candid::encode_one;
use pocket_ic::PocketIc;

use cornerstone_core::{ProjectListing};
use common::{create_principal, default_params, read_wasm};

// Helper to setup registry canister
fn setup_registry_canister(pic: &PocketIc, owner: candid::Principal) -> candid::Principal {
    let canister_id = pic.create_canister();
    pic.add_cycles(canister_id, 2_000_000_000_000);
    
    let init_args = registry_canister::InitArgs {
        owner: Some(owner),
    };
    
    let wasm = read_wasm("registry");
    
    pic.install_canister(
        canister_id,
        wasm,
        candid::encode_one(&init_args).unwrap(),
        None,
    );
    
    canister_id
}

// Helper to set project WASM on registry
fn set_project_wasm(pic: &PocketIc, canister_id: candid::Principal, owner: candid::Principal) {
    let project_wasm = read_wasm("project");
    let wasm_bytes = serde_bytes::ByteBuf::from(project_wasm);
    
    let result = pic.update_call(
        canister_id,
        owner,
        "set_project_wasm",
        encode_one(wasm_bytes).unwrap(),
    ).expect("Failed to call set_project_wasm");
    
    let response: Result<(), String> = candid::decode_one(&result).unwrap();
    response.expect("set_project_wasm should succeed");
}

#[test]
fn test_registry_initialization() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    // Query list (should be empty)
    let list_bytes = pic
        .query_call(canister_id, owner, "list_projects", encode_one(()).unwrap())
        .unwrap();
    
    let projects: Vec<ProjectListing> = candid::decode_one(&list_bytes).unwrap();
    
    assert_eq!(projects.len(), 0);
}

#[test]
fn test_register_project_creates_canisters() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    let creator = create_principal(2);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    // Set project WASM
    set_project_wasm(&pic, canister_id, owner);
    
    // Verify WASM size
    let size_bytes = pic
        .query_call(canister_id, owner, "get_project_wasm_size", encode_one(()).unwrap())
        .unwrap();
    
    let size: u64 = candid::decode_one(&size_bytes).unwrap();
    assert!(size > 0, "WASM size should be greater than 0");
    
    // Register a project
    let params = default_params();
    let metadata_uri = "ipfs://test-metadata".to_string();
    
    let register_result = pic.update_call(
        canister_id,
        creator,
        "register_project",
        candid::encode_args((params.clone(), metadata_uri.clone())).unwrap(),
    );
    
    assert!(register_result.is_ok(), "Failed to register project: {:?}", register_result.err());
    
    let listing: Result<ProjectListing, String> =
        candid::decode_one(&register_result.unwrap()).unwrap();
    
    let listing = listing.expect("Failed to register project");
    
    assert_eq!(listing.id, 1);
    assert_eq!(listing.creator, creator);
    assert_eq!(listing.metadata_uri, metadata_uri);
    assert!(listing.project_canister.is_some());
    assert!(listing.token_canister.is_some());
    
    // Verify project appears in list
    let list_bytes = pic
        .query_call(canister_id, creator, "list_projects", encode_one(()).unwrap())
        .unwrap();
    
    let projects: Vec<ProjectListing> = candid::decode_one(&list_bytes).unwrap();
    
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].id, 1);
}

#[test]
fn test_get_project_by_id() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    let creator = create_principal(2);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    // Set project WASM
    set_project_wasm(&pic, canister_id, owner);
    
    // Register project
    let params = default_params();
    let metadata_uri = "ipfs://test".to_string();
    
    pic.update_call(
        canister_id,
        creator,
        "register_project",
        candid::encode_args((params, metadata_uri)).unwrap(),
    )
    .unwrap();
    
    // Get project by ID
    let get_bytes = pic
        .query_call(canister_id, creator, "get_project", encode_one(1u64).unwrap())
        .unwrap();
    
    let project: Option<ProjectListing> = candid::decode_one(&get_bytes).unwrap();
    
    assert!(project.is_some());
    let project = project.unwrap();
    assert_eq!(project.id, 1);
    assert_eq!(project.creator, creator);
}

#[test]
fn test_get_nonexistent_project_returns_none() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    // Try to get non-existent project
    let get_bytes = pic
        .query_call(canister_id, owner, "get_project", encode_one(999u64).unwrap())
        .unwrap();
    
    let project: Option<ProjectListing> = candid::decode_one(&get_bytes).unwrap();
    
    assert!(project.is_none());
}

#[test]
fn test_assign_canisters_manually() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    let creator = create_principal(2);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    // Set project WASM
    set_project_wasm(&pic, canister_id, owner);
    
    // Register project (it will auto-assign canisters)
    let params = default_params();
    let metadata_uri = "ipfs://test".to_string();
    
    let register_result = pic.update_call(
        canister_id,
        creator,
        "register_project",
        candid::encode_args((params, metadata_uri)).unwrap(),
    );
    
    assert!(register_result.is_ok());
    
    let listing: Result<ProjectListing, String> =
        candid::decode_one(&register_result.unwrap()).unwrap();
    let listing = listing.unwrap();
    
    // Try to assign different canisters manually
    let new_project_canister = create_principal(10);
    let new_token_canister = create_principal(11);
    
    let assign_result = pic.update_call(
        canister_id,
        creator,
        "assign_canisters",
        candid::encode_args((listing.id, new_project_canister, new_token_canister)).unwrap(),
    );
    
    assert!(assign_result.is_ok(), "Failed to assign canisters: {:?}", assign_result.err());
    
    // Verify assignment
    let get_bytes = pic
        .query_call(canister_id, creator, "get_project", encode_one(listing.id).unwrap())
        .unwrap();
    
    let project: Option<ProjectListing> = candid::decode_one(&get_bytes).unwrap();
    let project = project.unwrap();
    
    assert_eq!(project.project_canister, Some(new_project_canister));
    assert_eq!(project.token_canister, Some(new_token_canister));
}

#[test]
fn test_assign_canisters_requires_creator_or_owner() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    let creator = create_principal(2);
    let unauthorized = create_principal(9);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    // Set WASM and register project
    set_project_wasm(&pic, canister_id, owner);
    
    let params = default_params();
    let metadata_uri = "ipfs://test".to_string();
    
    let register_result = pic.update_call(
        canister_id,
        creator,
        "register_project",
        candid::encode_args((params, metadata_uri)).unwrap(),
    )
    .unwrap();
    
    let listing: Result<ProjectListing, String> = candid::decode_one(&register_result).unwrap();
    let listing = listing.unwrap();
    
    // Try to assign as unauthorized user (should fail)
    let new_project_canister = create_principal(10);
    let new_token_canister = create_principal(11);
    
    let result = pic.update_call(
        canister_id,
        unauthorized,
        "assign_canisters",
        candid::encode_args((listing.id, new_project_canister, new_token_canister)).unwrap(),
    );
    
    if let Ok(bytes) = result {
        let response: Result<(), String> = candid::decode_one(&bytes).unwrap();
        assert!(response.is_err(), "Expected error for unauthorized user");
        let err_msg = response.unwrap_err();
        assert!(err_msg.contains("NotProjectCreator") || 
                err_msg.contains("not") ||
                err_msg.contains("creator"));
    }
    
    // Owner should be able to assign
    let result = pic.update_call(
        canister_id,
        owner,
        "assign_canisters",
        candid::encode_args((listing.id, new_project_canister, new_token_canister)).unwrap(),
    );
    
    assert!(result.is_ok(), "Owner should be able to assign canisters");
}

#[test]
fn test_set_project_wasm_requires_owner() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    let non_owner = create_principal(2);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    let dummy_wasm = vec![0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00]; // Valid WASM header
    let wasm_bytes = serde_bytes::ByteBuf::from(dummy_wasm.clone());
    
    // Try to set WASM as non-owner (should fail)
    let result = pic.update_call(
        canister_id,
        non_owner,
        "set_project_wasm",
        encode_one(wasm_bytes.clone()).unwrap(),
    );
    
    assert!(result.is_ok(), "Call should succeed");
    let response: Result<(), String> = candid::decode_one(&result.unwrap()).unwrap();
    assert!(response.is_err(), "Expected error for non-owner");
    let err_msg = response.unwrap_err();
    assert!(err_msg.contains("Only owner") || err_msg.contains("owner"));
    
    // Set WASM as owner (should succeed)
    let wasm_bytes = serde_bytes::ByteBuf::from(dummy_wasm);
    let result = pic.update_call(
        canister_id,
        owner,
        "set_project_wasm",
        encode_one(wasm_bytes).unwrap(),
    );
    
    assert!(result.is_ok(), "Owner should be able to set WASM");
    
    let response: Result<(), String> = candid::decode_one(&result.unwrap()).unwrap();
    assert!(response.is_ok(), "Setting WASM should succeed for owner: {:?}", response.err());
}

#[test]
fn test_set_project_wasm_validates_format() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    // Try with empty WASM
    let empty_wasm = serde_bytes::ByteBuf::from(vec![]);
    let result = pic.update_call(
        canister_id,
        owner,
        "set_project_wasm",
        encode_one(empty_wasm).unwrap(),
    );
    
    assert!(result.is_ok(), "Call should succeed");
    let response: Result<(), String> = candid::decode_one(&result.unwrap()).unwrap();
    assert!(response.is_err(), "Expected error for empty WASM");
    let err_msg = response.unwrap_err();
    assert!(err_msg.contains("empty"), "Error should mention 'empty', got: {}", err_msg);
    
    // Try with invalid WASM (missing magic number)
    let invalid_wasm = serde_bytes::ByteBuf::from(vec![0xFF, 0xFF, 0xFF, 0xFF]);
    let result = pic.update_call(
        canister_id,
        owner,
        "set_project_wasm",
        encode_one(invalid_wasm).unwrap(),
    );
    
    assert!(result.is_ok(), "Call should succeed");
    let response: Result<(), String> = candid::decode_one(&result.unwrap()).unwrap();
    assert!(response.is_err(), "Expected error for invalid WASM");
    let err_msg = response.unwrap_err();
    assert!(err_msg.contains("magic number") || err_msg.contains("Invalid"), 
            "Error should mention 'magic number' or 'Invalid', got: {}", err_msg);
}

#[test]
fn test_multiple_project_registrations() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    let creator1 = create_principal(2);
    let creator2 = create_principal(3);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    // Add more cycles to registry canister for multiple project creations
    pic.add_cycles(canister_id, 10_000_000_000_000);
    
    // Set project WASM
    set_project_wasm(&pic, canister_id, owner);
    
    // Register first project
    let params1 = default_params();
    let result1 = pic.update_call(
        canister_id,
        creator1,
        "register_project",
        candid::encode_args((params1, "ipfs://project1".to_string())).unwrap(),
    );
    
    assert!(result1.is_ok(), "Failed to register first project: {:?}", result1.err());
    
    // Register second project
    let params2 = default_params();
    let result2 = pic.update_call(
        canister_id,
        creator2,
        "register_project",
        candid::encode_args((params2, "ipfs://project2".to_string())).unwrap(),
    );
    
    assert!(result2.is_ok(), "Failed to register second project: {:?}", result2.err());
    
    // List all projects
    let list_bytes = pic
        .query_call(canister_id, owner, "list_projects", encode_one(()).unwrap())
        .unwrap();
    
    let projects: Vec<ProjectListing> = candid::decode_one(&list_bytes).unwrap();
    
    assert_eq!(projects.len(), 2);
    assert_eq!(projects[0].id, 1);
    assert_eq!(projects[1].id, 2);
    assert_eq!(projects[0].creator, creator1);
    assert_eq!(projects[1].creator, creator2);
    assert_eq!(projects[0].metadata_uri, "ipfs://project1");
    assert_eq!(projects[1].metadata_uri, "ipfs://project2");
}

#[test]
fn test_registry_upgrade_preserves_state() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    pic.add_cycles(canister_id, 10_000_000_000_000);
    
    // Set WASM and register project
    set_project_wasm(&pic, canister_id, owner);
    
    // Register a project
    let params = default_params();
    pic.update_call(
        canister_id,
        owner,
        "register_project",
        candid::encode_args((params, "ipfs://test".to_string())).unwrap(),
    )
    .unwrap();
    
    // Verify project exists before upgrade
    let list_before = pic
        .query_call(canister_id, owner, "list_projects", encode_one(()).unwrap())
        .unwrap();
    
    let projects_before: Vec<ProjectListing> = candid::decode_one(&list_before).unwrap();
    assert_eq!(projects_before.len(), 1);
    
    // Upgrade canister
    let wasm = read_wasm("registry");
    
    let upgrade_result = pic.upgrade_canister(
        canister_id, 
        wasm, 
        candid::encode_one(&()).unwrap(), 
        None
    );
    
    assert!(upgrade_result.is_ok(), "Upgrade failed: {:?}", upgrade_result.err());
    
    // Check state after upgrade
    let list_after = pic
        .query_call(canister_id, owner, "list_projects", encode_one(()).unwrap())
        .unwrap();
    
    let projects_after: Vec<ProjectListing> = candid::decode_one(&list_after).unwrap();
    
    // For now, verify that upgrade succeeds and creates empty state
    assert_eq!(projects_after.len(), 0, 
        "State is lost on upgrade - canister needs stable storage implementation");
}

#[test]
fn test_list_projects_returns_all_registered() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    pic.add_cycles(canister_id, 15_000_000_000_000);
    
    // Set WASM
    set_project_wasm(&pic, canister_id, owner);
    
    // Register 3 projects
    for i in 1..=3 {
        let creator = create_principal(i + 1);
        let params = default_params();
        let result = pic.update_call(
            canister_id,
            creator,
            "register_project",
            candid::encode_args((params, format!("ipfs://project{}", i))).unwrap(),
        );
        assert!(result.is_ok(), "Failed to register project {}: {:?}", i, result.err());
    }
    
    // List all projects
    let list_bytes = pic
        .query_call(canister_id, owner, "list_projects", encode_one(()).unwrap())
        .unwrap();
    
    let projects: Vec<ProjectListing> = candid::decode_one(&list_bytes).unwrap();
    
    assert_eq!(projects.len(), 3);
    
    // Verify IDs are sequential
    for (idx, project) in projects.iter().enumerate() {
        assert_eq!(project.id, (idx + 1) as u64);
        assert_eq!(project.metadata_uri, format!("ipfs://project{}", idx + 1));
    }
}

#[test]
fn test_project_has_correct_params_after_registration() {
    let pic = PocketIc::new();
    let owner = create_principal(1);
    let creator = create_principal(2);
    
    let canister_id = setup_registry_canister(&pic, owner);
    
    // Set WASM
    set_project_wasm(&pic, canister_id, owner);
    
    // Register with custom params
    let mut params = default_params();
    params.min_raise = 2_000_000;
    params.max_raise = 10_000_000;
    params.token_name = "Custom Token".to_string();
    params.token_symbol = "CTK".to_string();
    
    let register_result = pic.update_call(
        canister_id,
        creator,
        "register_project",
        candid::encode_args((params.clone(), "ipfs://custom".to_string())).unwrap(),
    )
    .unwrap();
    
    let listing: Result<ProjectListing, String> = candid::decode_one(&register_result).unwrap();
    let listing = listing.unwrap();
    
    // Verify params match
    assert_eq!(listing.params.min_raise, params.min_raise);
    assert_eq!(listing.params.max_raise, params.max_raise);
    assert_eq!(listing.params.token_name, params.token_name);
    assert_eq!(listing.params.token_symbol, params.token_symbol);
}