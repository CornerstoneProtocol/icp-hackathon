use candid::{CandidType, Deserialize, Nat, Principal};
use num_traits::cast::ToPrimitive;
use ic_cdk::api::time;
use ic_cdk_macros::{init, post_upgrade, pre_upgrade, query, update};
use std::cell::RefCell;
use std::collections::HashMap;

// ============================================================================
// Types
// ============================================================================

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Account {
    pub owner: Principal,
    pub subaccount: Option<Vec<u8>>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct TransferArg {
    pub from_subaccount: Option<Vec<u8>>,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct TransferFromArg {
    pub spender_subaccount: Option<Vec<u8>>,
    pub from: Account,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ApproveArg {
    pub from_subaccount: Option<Vec<u8>>,
    pub spender: Account,
    pub amount: Nat,
    pub expected_allowance: Option<Nat>,
    pub expires_at: Option<u64>,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct AllowanceArgs {
    pub account: Account,
    pub spender: Account,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Allowance {
    pub allowance: Nat,
    pub expires_at: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
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

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum ApproveError {
    BadFee { expected_fee: Nat },
    InsufficientFunds { balance: Nat },
    AllowanceChanged { current_allowance: Nat },
    Expired { ledger_time: u64 },
    TooOld,
    CreatedInFuture { ledger_time: u64 },
    Duplicate { duplicate_of: Nat },
    TemporarilyUnavailable,
    GenericError { error_code: Nat, message: String },
}

pub type TransferResult = Result<Nat, TransferError>;
pub type ApproveResult = Result<Nat, ApproveError>;

// ============================================================================
// State
// ============================================================================

#[derive(CandidType, Deserialize, Clone)]
pub struct TokenState {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: u128,
    pub balances: HashMap<String, u128>,
    pub allowances: HashMap<String, HashMap<String, AllowanceData>>,
    pub transaction_count: u64,
    pub fee: u128,
}

#[derive(CandidType, Deserialize, Clone)]
pub struct AllowanceData {
    pub amount: u128,
    pub expires_at: Option<u64>,
}

impl Default for TokenState {
    fn default() -> Self {
        Self {
            name: "Chain Key USDC".to_string(),
            symbol: "ckUSDC".to_string(),
            decimals: 6,
            total_supply: 0,
            balances: HashMap::new(),
            allowances: HashMap::new(),
            transaction_count: 0,
            fee: 10_000, // 0.01 USDC fee
        }
    }
}

thread_local! {
    static STATE: RefCell<TokenState> = RefCell::new(TokenState::default());
}

// ============================================================================
// Lifecycle Hooks
// ============================================================================

#[init]
fn init() {
    STATE.with(|s| {
        let mut state = s.borrow_mut();
        state.name = "Chain Key USDC".to_string();
        state.symbol = "ckUSDC".to_string();
        state.decimals = 6;
        state.fee = 10_000;
    });
}

#[pre_upgrade]
fn pre_upgrade() {
    STATE.with(|s| {
        let state = s.borrow();
        ic_cdk::storage::stable_save((&*state,)).expect("Failed to save state");
    });
}

#[post_upgrade]
fn post_upgrade() {
    let (state,): (TokenState,) = ic_cdk::storage::stable_restore().expect("Failed to restore state");
    STATE.with(|s| {
        *s.borrow_mut() = state;
    });
}

// ============================================================================
// Helper Functions
// ============================================================================

fn account_to_string(account: &Account) -> String {
    if let Some(sub) = &account.subaccount {
        format!("{}:{}", account.owner.to_text(), hex::encode(sub))
    } else {
        account.owner.to_text()
    }
}

fn nat_to_u128(nat: &Nat) -> u128 {
    nat.0.to_u128().unwrap_or(0)
}

fn get_balance(account: &Account) -> u128 {
    STATE.with(|s| {
        let state = s.borrow();
        let key = account_to_string(account);
        *state.balances.get(&key).unwrap_or(&0)
    })
}

fn set_balance(account: &Account, amount: u128) {
    STATE.with(|s| {
        let mut state = s.borrow_mut();
        let key = account_to_string(account);
        if amount == 0 {
            state.balances.remove(&key);
        } else {
            state.balances.insert(key, amount);
        }
    });
}

fn get_allowance_internal(account: &Account, spender: &Account) -> AllowanceData {
    STATE.with(|s| {
        let state = s.borrow();
        let owner_key = account_to_string(account);
        let spender_key = account_to_string(spender);
        
        state
            .allowances
            .get(&owner_key)
            .and_then(|spenders| spenders.get(&spender_key))
            .cloned()
            .unwrap_or(AllowanceData {
                amount: 0,
                expires_at: None,
            })
    })
}

fn set_allowance_internal(account: &Account, spender: &Account, data: AllowanceData) {
    STATE.with(|s| {
        let mut state = s.borrow_mut();
        let owner_key = account_to_string(account);
        let spender_key = account_to_string(spender);
        
        if data.amount == 0 {
            if let Some(spenders) = state.allowances.get_mut(&owner_key) {
                spenders.remove(&spender_key);
            }
        } else {
            state
                .allowances
                .entry(owner_key)
                .or_insert_with(HashMap::new)
                .insert(spender_key, data);
        }
    });
}

fn is_allowance_expired(expires_at: Option<u64>) -> bool {
    if let Some(exp) = expires_at {
        time() > exp
    } else {
        false
    }
}

// ============================================================================
// ICRC-1 Standard Methods
// ============================================================================

#[query]
fn icrc1_name() -> String {
    STATE.with(|s| s.borrow().name.clone())
}

#[query]
fn icrc1_symbol() -> String {
    STATE.with(|s| s.borrow().symbol.clone())
}

#[query]
fn icrc1_decimals() -> u8 {
    STATE.with(|s| s.borrow().decimals)
}

#[query]
fn icrc1_fee() -> Nat {
    STATE.with(|s| Nat::from(s.borrow().fee))
}

#[query]
fn icrc1_metadata() -> Vec<(String, String)> {
    STATE.with(|s| {
        let state = s.borrow();
        vec![
            ("icrc1:name".to_string(), state.name.clone()),
            ("icrc1:symbol".to_string(), state.symbol.clone()),
            ("icrc1:decimals".to_string(), state.decimals.to_string()),
            ("icrc1:fee".to_string(), state.fee.to_string()),
        ]
    })
}

#[query]
fn icrc1_total_supply() -> Nat {
    STATE.with(|s| Nat::from(s.borrow().total_supply))
}

#[query]
fn icrc1_minting_account() -> Option<Account> {
    Some(Account {
        owner: ic_cdk::api::id(),
        subaccount: None,
    })
}

#[query]
fn icrc1_balance_of(account: Account) -> Nat {
    Nat::from(get_balance(&account))
}

#[query]
fn icrc1_supported_standards() -> Vec<(String, String)> {
    vec![
        ("ICRC-1".to_string(), "1.0.0".to_string()),
        ("ICRC-2".to_string(), "1.0.0".to_string()),
    ]
}

#[update]
fn icrc1_transfer(args: TransferArg) -> TransferResult {
    let caller = ic_cdk::caller();
    let from = Account {
        owner: caller,
        subaccount: args.from_subaccount.clone(),
    };
    
    let fee = STATE.with(|s| s.borrow().fee);
    
    // Check fee
    if let Some(provided_fee) = args.fee {
        if nat_to_u128(&provided_fee) != fee {
            return Err(TransferError::BadFee {
                expected_fee: Nat::from(fee),
            });
        }
    }
    
    let amount = nat_to_u128(&args.amount);
    let total_needed = amount + fee;
    
    let from_balance = get_balance(&from);
    if from_balance < total_needed {
        return Err(TransferError::InsufficientFunds {
            balance: Nat::from(from_balance),
        });
    }
    
    // Perform transfer
    set_balance(&from, from_balance - total_needed);
    let to_balance = get_balance(&args.to);
    set_balance(&args.to, to_balance + amount);
    
    // Increment transaction count
    let tx_id = STATE.with(|s| {
        let mut state = s.borrow_mut();
        state.transaction_count += 1;
        state.transaction_count
    });
    
    Ok(Nat::from(tx_id))
}

// ============================================================================
// ICRC-2 Standard Methods (Approve/TransferFrom)
// ============================================================================

#[update]
fn icrc2_approve(args: ApproveArg) -> ApproveResult {
    let caller = ic_cdk::caller();
    let from = Account {
        owner: caller,
        subaccount: args.from_subaccount.clone(),
    };
    
    let fee = STATE.with(|s| s.borrow().fee);
    
    // Check fee
    if let Some(provided_fee) = args.fee {
        if nat_to_u128(&provided_fee) != fee {
            return Err(ApproveError::BadFee {
                expected_fee: Nat::from(fee),
            });
        }
    }
    
    // Check balance for fee
    let from_balance = get_balance(&from);
    if from_balance < fee {
        return Err(ApproveError::InsufficientFunds {
            balance: Nat::from(from_balance),
        });
    }
    
    // Check expected allowance if provided
    if let Some(expected) = args.expected_allowance {
        let current = get_allowance_internal(&from, &args.spender);
        if nat_to_u128(&expected) != current.amount {
            return Err(ApproveError::AllowanceChanged {
                current_allowance: Nat::from(current.amount),
            });
        }
    }
    
    // Deduct fee
    set_balance(&from, from_balance - fee);
    
    // Set allowance
    let amount = nat_to_u128(&args.amount);
    set_allowance_internal(&from, &args.spender, AllowanceData {
        amount,
        expires_at: args.expires_at,
    });
    
    // Increment transaction count
    let tx_id = STATE.with(|s| {
        let mut state = s.borrow_mut();
        state.transaction_count += 1;
        state.transaction_count
    });
    
    Ok(Nat::from(tx_id))
}

#[query]
fn icrc2_allowance(args: AllowanceArgs) -> Allowance {
    let data = get_allowance_internal(&args.account, &args.spender);
    Allowance {
        allowance: Nat::from(data.amount),
        expires_at: data.expires_at,
    }
}

#[update]
fn icrc2_transfer_from(args: TransferFromArg) -> TransferResult {
    let caller = ic_cdk::caller();
    let spender = Account {
        owner: caller,
        subaccount: args.spender_subaccount.clone(),
    };
    
    let fee = STATE.with(|s| s.borrow().fee);
    
    // Check fee
    if let Some(provided_fee) = args.fee {
        if nat_to_u128(&provided_fee) != fee {
            return Err(TransferError::BadFee {
                expected_fee: Nat::from(fee),
            });
        }
    }
    
    let amount = nat_to_u128(&args.amount);
    let total_needed = amount + fee;
    
    // Check allowance
    let allowance_data = get_allowance_internal(&args.from, &spender);
    if is_allowance_expired(allowance_data.expires_at) {
        return Err(TransferError::GenericError {
            error_code: Nat::from(1u64),
            message: "Allowance expired".to_string(),
        });
    }
    
    if allowance_data.amount < total_needed {
        return Err(TransferError::InsufficientFunds {
            balance: Nat::from(allowance_data.amount),
        });
    }
    
    // Check balance
    let from_balance = get_balance(&args.from);
    if from_balance < total_needed {
        return Err(TransferError::InsufficientFunds {
            balance: Nat::from(from_balance),
        });
    }
    
    // Perform transfer
    set_balance(&args.from, from_balance - total_needed);
    let to_balance = get_balance(&args.to);
    set_balance(&args.to, to_balance + amount);
    
    // Update allowance
    set_allowance_internal(&args.from, &spender, AllowanceData {
        amount: allowance_data.amount - total_needed,
        expires_at: allowance_data.expires_at,
    });
    
    // Increment transaction count
    let tx_id = STATE.with(|s| {
        let mut state = s.borrow_mut();
        state.transaction_count += 1;
        state.transaction_count
    });
    
    Ok(Nat::from(tx_id))
}

// ============================================================================
// Mock Utility Methods (for testing)
// ============================================================================

#[update]
fn mint(to: Account, amount: Nat) -> Nat {
    let amount_u128 = nat_to_u128(&amount);
    
    STATE.with(|s| {
        let mut state = s.borrow_mut();
        state.total_supply += amount_u128;
    });
    
    let to_balance = get_balance(&to);
    set_balance(&to, to_balance + amount_u128);
    
    let tx_id = STATE.with(|s| {
        let mut state = s.borrow_mut();
        state.transaction_count += 1;
        state.transaction_count
    });
    
    Nat::from(tx_id)
}

#[update]
fn burn(from: Account, amount: Nat) -> Result<Nat, String> {
    let amount_u128 = nat_to_u128(&amount);
    let from_balance = get_balance(&from);
    
    if from_balance < amount_u128 {
        return Err("Insufficient balance".to_string());
    }
    
    STATE.with(|s| {
        let mut state = s.borrow_mut();
        state.total_supply -= amount_u128;
    });
    
    set_balance(&from, from_balance - amount_u128);
    
    let tx_id = STATE.with(|s| {
        let mut state = s.borrow_mut();
        state.transaction_count += 1;
        state.transaction_count
    });
    
    Ok(Nat::from(tx_id))
}

#[query]
fn get_transaction_count() -> u64 {
    STATE.with(|s| s.borrow().transaction_count)
}

// Export candid interface
ic_cdk::export_candid!();