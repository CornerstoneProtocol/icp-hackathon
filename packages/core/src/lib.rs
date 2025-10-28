use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

pub type Timestamp = u64;
pub type Amount = u128;
pub type BasisPoints = u32;

pub const NUM_PHASES: u8 = 5;
pub const BPS_DENOM: u128 = 10_000;
pub const ACC_PREC: u128 = 1_000_000_000_000_000_000; // 1e18
pub const YEAR_SECONDS: u64 = 31_536_000; // 365 days

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("contract paused")]
    Paused,
    #[error("fundraise ended")]
    FundraiseEnded,
    #[error("fundraise failed")]
    FundraiseFailed,
    #[error("amount must be greater than zero")]
    AmountZero,
    #[error("phase closed")]
    PhaseClosed,
    #[error("invalid phase")]
    InvalidPhase,
    #[error("docs required")]
    DocsRequired,
    #[error("docs length mismatch")]
    DocsLengthMismatch,
    #[error("min raise not met")]
    MinRaiseNotMet,
    #[error("exceeds caps")]
    ExceedsCaps,
    #[error("insufficient pool balance")]
    InsufficientPool,
    #[error("insufficient reserve")]
    ReserveDepleted,
    #[error("insufficient claimable amount")]
    InsufficientClaimable,
    #[error("insufficient principal buffer")]
    InsufficientPrincipalBuffer,
    #[error("insufficient shares")]
    InsufficientShares,
    #[error("deposits closed in phase 5")]
    DepositsClosed,
    #[error("arithmetic overflow")]
    ArithmeticOverflow,
    #[error("not in phase five")]
    NotPhaseFive,
    #[error("percent out of range")]
    PercentOutOfRange,
    #[error("percent must be >= last submission")]
    PercentBelowLast,
    #[error("refunds unavailable")]
    RefundUnavailable,
    #[error("project not found")]
    ProjectNotFound,
    #[error("caller not project creator")]
    NotProjectCreator,
}

#[derive(Debug, Clone, Serialize, Deserialize, CandidType)]
pub struct DocRecord {
    pub doc_types: Vec<String>,
    pub doc_hashes: Vec<String>,
    pub metadata_uris: Vec<String>,
    pub submitted_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, Deserialize, CandidType)]
pub struct AppraisalRecord {
    pub percent_complete: u8,
    pub appraisal_hash: String,
    pub submitted_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, Deserialize, CandidType)]
pub struct ProjectParams {
    pub stablecoin: String,
    pub min_raise: Amount,
    pub max_raise: Amount,
    pub fundraise_deadline: Timestamp,
    pub phase_aprs_bps: [BasisPoints; 6],
    pub phase_durations: [u64; 6],
    pub phase_withdraw_caps_bps: [BasisPoints; 6],
    pub token_name: String,
    pub token_symbol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, CandidType)]
pub struct AccountState {
    pub balance: Amount,
    pub interest_correction: i128,
    pub revenue_correction: i128,
    pub interest_withdrawn: Amount,
    pub revenue_withdrawn: Amount,
}

#[derive(Debug, Clone, Serialize, Deserialize, CandidType)]
pub struct ProjectState {
    pub owner: Principal,
    pub params: ProjectParams,
    pub paused: bool,
    pub current_phase: u8,
    pub last_closed_phase: u8,
    pub fundraise_closed: bool,
    pub fundraise_successful: bool,
    pub total_raised: Amount,
    pub pool_balance: Amount,
    pub reserve_balance: Amount,
    pub accrual_base: Amount,
    pub last_accrual_ts: Timestamp,
    pub principal_buffer: Amount,
    pub principal_redeemed: Amount,
    pub total_dev_withdrawn: Amount,
    pub phase_withdrawn: [Amount; 6],
    pub phase_docs: Vec<Vec<DocRecord>>,
    pub appraisals: Vec<AppraisalRecord>,
    pub phase5_percent_complete: u8,
    pub last_appraisal_hash: Option<String>,
    pub total_supply: Amount,
    pub interest_per_share_x18: u128,
    pub revenue_per_share_x18: u128,
    pub accounts: BTreeMap<Principal, AccountState>,
}

impl ProjectState {
    pub fn new(owner: Principal, params: ProjectParams, now: Timestamp) -> Self {
        Self {
            owner,
            params,
            paused: false,
            current_phase: 0,
            last_closed_phase: 0,
            fundraise_closed: false,
            fundraise_successful: false,
            total_raised: 0,
            pool_balance: 0,
            reserve_balance: 0,
            accrual_base: 0,
            last_accrual_ts: now,
            principal_buffer: 0,
            principal_redeemed: 0,
            total_dev_withdrawn: 0,
            phase_withdrawn: [0; 6],
            phase_docs: vec![Vec::new(); 6],
            appraisals: Vec::new(),
            phase5_percent_complete: 0,
            last_appraisal_hash: None,
            total_supply: 0,
            interest_per_share_x18: 0,
            revenue_per_share_x18: 0,
            accounts: BTreeMap::new(),
        }
    }

    pub fn ensure_owner(&self, caller: &Principal) -> Result<(), ProjectError> {
        if &self.owner == caller {
            Ok(())
        } else {
            Err(ProjectError::Unauthorized)
        }
    }

    fn ensure_not_paused(&self) -> Result<(), ProjectError> {
        if self.paused {
            Err(ProjectError::Paused)
        } else {
            Ok(())
        }
    }

    fn account_mut(&mut self, id: &Principal) -> &mut AccountState {
        self.accounts
            .entry(id.clone())
            .or_insert_with(AccountState::default)
    }

    fn account(&self, id: &Principal) -> AccountState {
        self.accounts.get(id).cloned().unwrap_or_default()
    }

    fn accrue_interest_internal(&mut self, now: Timestamp) -> Result<(), ProjectError> {
        if !(self.fundraise_successful && self.current_phase >= 1) {
            self.last_accrual_ts = now;
            return Ok(());
        }
        if now <= self.last_accrual_ts {
            return Ok(());
        }
        let dt = now - self.last_accrual_ts;
        self.last_accrual_ts = now;
        let apr_bps = self.params.phase_aprs_bps[self.current_phase as usize] as u128;
        if apr_bps == 0 || self.accrual_base == 0 {
            return Ok(());
        }
        let interest = self
            .accrual_base
            .checked_mul(apr_bps)
            .and_then(|v| v.checked_mul(dt as u128))
            .and_then(|v| v.checked_div(BPS_DENOM * YEAR_SECONDS as u128))
            .ok_or(ProjectError::ArithmeticOverflow)?;
        if interest == 0 {
            return Ok(());
        }
        if self.reserve_balance < interest {
            return Err(ProjectError::ReserveDepleted);
        }
        self.reserve_balance -= interest;
        self.pool_balance += interest;
        self.accrual_base += interest;
        if self.total_supply > 0 {
            let increment = interest
                .checked_mul(ACC_PREC)
                .and_then(|v| v.checked_div(self.total_supply))
                .ok_or(ProjectError::ArithmeticOverflow)?;
            self.interest_per_share_x18 = self
                .interest_per_share_x18
                .checked_add(increment)
                .ok_or(ProjectError::ArithmeticOverflow)?;
        }
        Ok(())
    }

    fn distribute_revenue(&mut self, amount: Amount) -> Result<(), ProjectError> {
        if amount == 0 {
            return Ok(());
        }
        if self.total_supply == 0 {
            return Ok(());
        }
        let increment = amount
            .checked_mul(ACC_PREC)
            .and_then(|v| v.checked_div(self.total_supply))
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.revenue_per_share_x18 = self
            .revenue_per_share_x18
            .checked_add(increment)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        Ok(())
    }

    fn apply_transfer_corrections(
        &mut self,
        from: Option<Principal>,
        to: Option<Principal>,
        amount: Amount,
    ) -> Result<(), ProjectError> {
        if amount == 0 {
            return Ok(());
        }
        let i_delta = self
            .interest_per_share_x18
            .checked_mul(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        let r_delta = self
            .revenue_per_share_x18
            .checked_mul(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        let i_delta_signed =
            i128::try_from(i_delta).map_err(|_| ProjectError::ArithmeticOverflow)?;
        let r_delta_signed =
            i128::try_from(r_delta).map_err(|_| ProjectError::ArithmeticOverflow)?;
        if let Some(from_id) = from {
            let acct = self.account_mut(&from_id);
            acct.interest_correction = acct
                .interest_correction
                .checked_add(i_delta_signed)
                .ok_or(ProjectError::ArithmeticOverflow)?;
            acct.revenue_correction = acct
                .revenue_correction
                .checked_add(r_delta_signed)
                .ok_or(ProjectError::ArithmeticOverflow)?;
        }
        if let Some(to_id) = to {
            let acct = self.account_mut(&to_id);
            acct.interest_correction = acct
                .interest_correction
                .checked_sub(i_delta_signed)
                .ok_or(ProjectError::ArithmeticOverflow)?;
            acct.revenue_correction = acct
                .revenue_correction
                .checked_sub(r_delta_signed)
                .ok_or(ProjectError::ArithmeticOverflow)?;
        }
        Ok(())
    }

    pub fn pause(&mut self, caller: &Principal) -> Result<(), ProjectError> {
        self.ensure_owner(caller)?;
        self.paused = true;
        Ok(())
    }

    pub fn unpause(&mut self, caller: &Principal) -> Result<(), ProjectError> {
        self.ensure_owner(caller)?;
        self.paused = false;
        Ok(())
    }

    pub fn deposit(
        &mut self,
        caller: &Principal,
        amount: Amount,
        now: Timestamp,
    ) -> Result<(), ProjectError> {
        self.ensure_not_paused()?;
        if self.current_phase == NUM_PHASES {
            return Err(ProjectError::DepositsClosed);
        }
        if self.fundraise_closed && !self.fundraise_successful {
            return Err(ProjectError::FundraiseFailed);
        }
        if self.current_phase == 0 {
            if now > self.params.fundraise_deadline || self.fundraise_closed {
                return Err(ProjectError::FundraiseEnded);
            }
        }
        if amount == 0 {
            return Err(ProjectError::AmountZero);
        }
        self.accrue_interest_internal(now)?;
        self.total_raised = self
            .total_raised
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.pool_balance = self
            .pool_balance
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.accrual_base = self
            .accrual_base
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        if !self.fundraise_successful && self.total_raised >= self.params.min_raise {
            self.fundraise_successful = true;
        }
        self.mint_shares(caller, amount)?;
        Ok(())
    }

    fn mint_shares(&mut self, to: &Principal, amount: Amount) -> Result<(), ProjectError> {
        let acct = self.account_mut(to);
        acct.balance = acct
            .balance
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.total_supply = self
            .total_supply
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.apply_transfer_corrections(None, Some(to.clone()), amount)?;
        Ok(())
    }

    fn burn_shares(&mut self, from: &Principal, amount: Amount) -> Result<(), ProjectError> {
        let acct = self.account_mut(from);
        if acct.balance < amount {
            return Err(ProjectError::InsufficientShares);
        }
        acct.balance -= amount;
        self.total_supply -= amount;
        self.apply_transfer_corrections(Some(from.clone()), None, amount)?;
        Ok(())
    }

    pub fn close_phase(
        &mut self,
        caller: &Principal,
        phase_id: u8,
        docs: DocRecord,
        now: Timestamp,
    ) -> Result<(), ProjectError> {
        self.ensure_not_paused()?;
        self.ensure_owner(caller)?;
        self.accrue_interest_internal(now)?;
        if phase_id > NUM_PHASES {
            return Err(ProjectError::InvalidPhase);
        }
        if phase_id != self.current_phase {
            return Err(ProjectError::InvalidPhase);
        }
        if docs.doc_types.is_empty() {
            return Err(ProjectError::DocsRequired);
        }
        let len = docs.doc_types.len();
        if docs.doc_hashes.len() != len || docs.metadata_uris.len() != len {
            return Err(ProjectError::DocsLengthMismatch);
        }
        let mut docs = docs;
        docs.submitted_at = now;
        self.phase_docs[phase_id as usize].push(docs);
        if phase_id == 0 {
            if self.total_raised < self.params.min_raise {
                return Err(ProjectError::MinRaiseNotMet);
            }
            if !self.fundraise_successful && self.total_raised >= self.params.min_raise {
                self.fundraise_successful = true;
            }
            self.current_phase = 1;
            self.last_closed_phase = 0;
            return Ok(());
        }
        self.last_closed_phase = phase_id;
        if self.current_phase < NUM_PHASES {
            self.current_phase += 1;
        }
        if phase_id == 4 && !self.fundraise_closed {
            self.fundraise_closed = true;
        }
        if phase_id == 5 {
            self.phase5_percent_complete = 100;
        }
        Ok(())
    }

    pub fn submit_appraisal(
        &mut self,
        caller: &Principal,
        percent_complete: u8,
        appraisal_hash: String,
        now: Timestamp,
    ) -> Result<(), ProjectError> {
        self.ensure_owner(caller)?;
        self.ensure_not_paused()?;
        self.accrue_interest_internal(now)?;
        if self.current_phase != NUM_PHASES {
            return Err(ProjectError::NotPhaseFive);
        }
        if percent_complete > 100 {
            return Err(ProjectError::PercentOutOfRange);
        }
        if percent_complete < self.phase5_percent_complete {
            return Err(ProjectError::PercentBelowLast);
        }
        self.phase5_percent_complete = percent_complete;
        self.last_appraisal_hash = Some(appraisal_hash.clone());
        self.appraisals.push(AppraisalRecord {
            percent_complete,
            appraisal_hash,
            submitted_at: now,
        });
        Ok(())
    }

    fn cumulative_unlocked(&self) -> Result<Amount, ProjectError> {
        let mut unlocked: Amount = 0;
        if self.current_phase >= 1 {
            unlocked = unlocked
                .checked_add(self.phase_cap(0)?)
                .ok_or(ProjectError::ArithmeticOverflow)?;
        }
        for p in 1..=4u8 {
            if p <= self.last_closed_phase {
                unlocked = unlocked
                    .checked_add(self.phase_cap(p)?)
                    .ok_or(ProjectError::ArithmeticOverflow)?;
            }
        }
        let cap5 = self.phase_cap(5)?;
        if self.last_closed_phase >= 5 {
            unlocked = unlocked
                .checked_add(cap5)
                .ok_or(ProjectError::ArithmeticOverflow)?;
        } else if self.current_phase == 5 {
            let partial = cap5
                .checked_mul(self.phase5_percent_complete as u128)
                .and_then(|v| v.checked_div(100))
                .ok_or(ProjectError::ArithmeticOverflow)?;
            unlocked = unlocked
                .checked_add(partial)
                .ok_or(ProjectError::ArithmeticOverflow)?;
        }
        Ok(unlocked)
    }

    fn phase_cap(&self, phase_id: u8) -> Result<Amount, ProjectError> {
        let cap_bps = self.params.phase_withdraw_caps_bps[phase_id as usize] as u128;
        self.params
            .max_raise
            .checked_mul(cap_bps)
            .and_then(|v| v.checked_div(BPS_DENOM))
            .ok_or(ProjectError::ArithmeticOverflow)
    }

    fn phase_attribution_for_withdrawal(&self) -> u8 {
        if self.current_phase == 5 && self.last_closed_phase < 5 {
            return 5;
        }
        if self.last_closed_phase >= 1 && self.last_closed_phase <= NUM_PHASES {
            self.last_closed_phase
        } else {
            0
        }
    }

    pub fn withdraw_phase_funds(
        &mut self,
        caller: &Principal,
        amount: Amount,
        now: Timestamp,
    ) -> Result<(), ProjectError> {
        self.ensure_owner(caller)?;
        self.ensure_not_paused()?;
        self.accrue_interest_internal(now)?;
        if !self.fundraise_successful {
            return Err(ProjectError::FundraiseFailed);
        }
        if amount == 0 {
            return Err(ProjectError::AmountZero);
        }
        let unlocked = self.cumulative_unlocked()?;
        if self.total_dev_withdrawn + amount > unlocked {
            return Err(ProjectError::ExceedsCaps);
        }
        if self.pool_balance < amount {
            return Err(ProjectError::InsufficientPool);
        }
        self.total_dev_withdrawn += amount;
        let phase_attr = self.phase_attribution_for_withdrawal();
        if let Some(slot) = self.phase_withdrawn.get_mut(phase_attr as usize) {
            *slot = slot
                .checked_add(amount)
                .ok_or(ProjectError::ArithmeticOverflow)?;
        }
        self.pool_balance -= amount;
        Ok(())
    }

    pub fn fund_reserve(&mut self, caller: &Principal, amount: Amount) -> Result<(), ProjectError> {
        self.ensure_owner(caller)?;
        self.ensure_not_paused()?;
        if amount == 0 {
            return Err(ProjectError::AmountZero);
        }
        self.reserve_balance = self
            .reserve_balance
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        Ok(())
    }

    pub fn submit_sales_proceeds(
        &mut self,
        caller: &Principal,
        amount: Amount,
        now: Timestamp,
    ) -> Result<(), ProjectError> {
        self.ensure_owner(caller)?;
        self.ensure_not_paused()?;
        self.accrue_interest_internal(now)?;
        if amount == 0 {
            return Err(ProjectError::AmountZero);
        }
        self.pool_balance = self
            .pool_balance
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.accrual_base = self
            .accrual_base
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.principal_buffer = self
            .principal_buffer
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        let principal_outstanding = self
            .total_raised
            .checked_sub(self.principal_redeemed)
            .unwrap_or(0);
        if self.principal_buffer > principal_outstanding {
            let revenue = self.principal_buffer - principal_outstanding;
            self.principal_buffer = principal_outstanding;
            self.distribute_revenue(revenue)?;
        }
        Ok(())
    }

    pub fn claim_interest(
        &mut self,
        caller: &Principal,
        amount: Amount,
        now: Timestamp,
    ) -> Result<Amount, ProjectError> {
        self.ensure_not_paused()?;
        self.accrue_interest_internal(now)?;
        if amount == 0 {
            return Err(ProjectError::AmountZero);
        }
        let claimable = self.claimable_interest(caller);
        if claimable < amount {
            return Err(ProjectError::InsufficientClaimable);
        }
        let acct = self.account_mut(caller);
        acct.interest_withdrawn = acct
            .interest_withdrawn
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.pool_balance = self
            .pool_balance
            .checked_sub(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.accrual_base = self
            .accrual_base
            .checked_sub(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        Ok(amount)
    }

    pub fn claim_revenue(
        &mut self,
        caller: &Principal,
        now: Timestamp,
    ) -> Result<Amount, ProjectError> {
        self.ensure_not_paused()?;
        self.accrue_interest_internal(now)?;
        let claimable = self.claimable_revenue(caller);
        if claimable == 0 {
            return Err(ProjectError::InsufficientClaimable);
        }
        let acct = self.account_mut(caller);
        acct.revenue_withdrawn = acct
            .revenue_withdrawn
            .checked_add(claimable)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.pool_balance = self
            .pool_balance
            .checked_sub(claimable)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        Ok(claimable)
    }

    pub fn withdraw_principal(
        &mut self,
        caller: &Principal,
        shares: Amount,
        now: Timestamp,
    ) -> Result<Amount, ProjectError> {
        self.ensure_not_paused()?;
        self.accrue_interest_internal(now)?;
        if shares == 0 {
            return Err(ProjectError::AmountZero);
        }
        if !self.fundraise_successful {
            return Err(ProjectError::FundraiseFailed);
        }
        let acct = self.account_mut(caller);
        if acct.balance < shares {
            return Err(ProjectError::InsufficientShares);
        }
        if self.principal_buffer < shares {
            return Err(ProjectError::InsufficientPrincipalBuffer);
        }
        self.principal_buffer = self
            .principal_buffer
            .checked_sub(shares)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.principal_redeemed = self
            .principal_redeemed
            .checked_add(shares)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.pool_balance = self
            .pool_balance
            .checked_sub(shares)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.accrual_base = self
            .accrual_base
            .checked_sub(shares)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.burn_shares(caller, shares)?;
        Ok(shares)
    }

    pub fn refund_if_min_not_met(
        &mut self,
        caller: &Principal,
        now: Timestamp,
    ) -> Result<Amount, ProjectError> {
        self.ensure_not_paused()?;
        self.accrue_interest_internal(now)?;
        if !self.fundraise_successful
            && !self.fundraise_closed
            && now > self.params.fundraise_deadline
        {
            self.fundraise_closed = true;
        }
        if !(self.fundraise_closed && !self.fundraise_successful) {
            return Err(ProjectError::RefundUnavailable);
        }
        let acct = self.account(caller);
        if acct.balance == 0 {
            return Err(ProjectError::InsufficientShares);
        }
        let amount = acct.balance;
        self.total_raised = self
            .total_raised
            .checked_sub(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.pool_balance = self
            .pool_balance
            .checked_sub(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.accrual_base = self
            .accrual_base
            .checked_sub(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.burn_shares(caller, amount)?;
        Ok(amount)
    }

    pub fn claimable_interest(&self, caller: &Principal) -> Amount {
        let acct = self.account(caller);
        let accum = acct
            .balance
            .checked_mul(self.interest_per_share_x18)
            .and_then(|v| v.checked_div(ACC_PREC))
            .unwrap_or(0);
        let correction = acct.interest_correction / ACC_PREC as i128;
        let corrected = (accum as i128) + correction;
        if corrected <= 0 {
            return 0;
        }
        let accrued = corrected as u128;
        if accrued <= acct.interest_withdrawn {
            0
        } else {
            accrued - acct.interest_withdrawn
        }
    }

    pub fn claimable_revenue(&self, caller: &Principal) -> Amount {
        let acct = self.account(caller);
        let accum = acct
            .balance
            .checked_mul(self.revenue_per_share_x18)
            .and_then(|v| v.checked_div(ACC_PREC))
            .unwrap_or(0);
        let correction = acct.revenue_correction / ACC_PREC as i128;
        let corrected = (accum as i128) + correction;
        if corrected <= 0 {
            return 0;
        }
        let accrued = corrected as u128;
        if accrued <= acct.revenue_withdrawn {
            0
        } else {
            accrued - acct.revenue_withdrawn
        }
    }

    pub fn accrue_interest(&mut self, now: Timestamp) -> Result<(), ProjectError> {
        self.accrue_interest_internal(now)
    }

    pub fn transfer_shares(
        &mut self,
        from: &Principal,
        to: &Principal,
        amount: Amount,
    ) -> Result<(), ProjectError> {
        if amount == 0 {
            return Ok(());
        }
        let from_acct = self.account_mut(from);
        if from_acct.balance < amount {
            return Err(ProjectError::InsufficientShares);
        }
        from_acct.balance -= amount;
        let to_acct = self.account_mut(to);
        to_acct.balance = to_acct
            .balance
            .checked_add(amount)
            .ok_or(ProjectError::ArithmeticOverflow)?;
        self.apply_transfer_corrections(Some(from.clone()), Some(to.clone()), amount)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, CandidType)]
pub struct ProjectListing {
    pub id: u64,
    pub creator: Principal,
    pub project_canister: Option<Principal>,
    pub token_canister: Option<Principal>,
    pub metadata_uri: String,
    pub params: ProjectParams,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, Deserialize, CandidType)]
pub struct RegistryState {
    pub owner: Principal,
    pub listings: Vec<ProjectListing>,
    pub next_id: u64,
}

impl RegistryState {
    pub fn new(owner: Principal) -> Self {
        Self {
            owner,
            listings: Vec::new(),
            next_id: 1,
        }
    }

    pub fn register_project(
        &mut self,
        caller: &Principal,
        params: ProjectParams,
        metadata_uri: String,
        now: Timestamp,
    ) -> ProjectListing {
        let id = self.next_id;
        self.next_id += 1;
        let listing = ProjectListing {
            id,
            creator: caller.clone(),
            project_canister: None,
            token_canister: None,
            metadata_uri,
            params,
            created_at: now,
        };
        self.listings.push(listing.clone());
        listing
    }

    pub fn assign_canisters(
        &mut self,
        caller: &Principal,
        id: u64,
        project_canister: Principal,
        token_canister: Principal,
    ) -> Result<(), ProjectError> {
        let listing = self
            .listings
            .iter_mut()
            .find(|l| l.id == id)
            .ok_or(ProjectError::ProjectNotFound)?;
        if &listing.creator != caller && &self.owner != caller {
            return Err(ProjectError::NotProjectCreator);
        }
        listing.project_canister = Some(project_canister);
        listing.token_canister = Some(token_canister);
        Ok(())
    }

    pub fn get(&self, id: u64) -> Option<ProjectListing> {
        self.listings.iter().find(|l| l.id == id).cloned()
    }

    pub fn list(&self) -> Vec<ProjectListing> {
        self.listings.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn principal(idx: u8) -> Principal {
        Principal::from_slice(&[idx; 29])
    }

    fn default_params() -> ProjectParams {
        ProjectParams {
            stablecoin: "ckUSDC".to_string(),
            min_raise: 1_000_000,
            max_raise: 2_000_000,
            fundraise_deadline: 1_000,
            phase_aprs_bps: [0, 400, 300, 300, 200, 100],
            phase_durations: [90, 90, 90, 90, 90, 90],
            phase_withdraw_caps_bps: [0, 2000, 2000, 2000, 2000, 2000],
            token_name: "Cornerstone Test".to_string(),
            token_symbol: "cTST".to_string(),
        }
    }

    fn doc(label: &str) -> DocRecord {
        DocRecord {
            doc_types: vec![label.to_string()],
            doc_hashes: vec!["hash".to_string()],
            metadata_uris: vec![format!("ipfs://{}", label)],
            submitted_at: 0,
        }
    }

    #[test]
    fn deposit_mints_shares_and_marks_success() {
        let dev = principal(1);
        let user = principal(2);
        let mut state = ProjectState::new(dev, default_params(), 0);
        state.deposit(&user, 1_200_000, 10).unwrap();
        assert_eq!(state.total_raised, 1_200_000);
        assert!(state.fundraise_successful);
        let acct = state.account(&user);
        assert_eq!(acct.balance, 1_200_000);
        assert_eq!(state.total_supply, 1_200_000);
    }

    #[test]
    fn close_phase_advances_and_records_docs() {
        let dev = principal(1);
        let mut state = ProjectState::new(dev, default_params(), 0);
        let user = principal(2);
        state.deposit(&user, 1_200_000, 10).unwrap();
        let docs = doc("phase-0");
        state.close_phase(&dev, 0, docs.clone(), 20).unwrap();
        assert_eq!(state.current_phase, 1);
        assert_eq!(state.phase_docs[0].len(), 1);
        assert_eq!(state.phase_docs[0][0].submitted_at, 20);
        assert!(state.close_phase(&dev, 0, docs, 21).is_err());
    }

    #[test]
    fn interest_accrual_and_claims() {
        let dev = principal(1);
        let user1 = principal(2);
        let user2 = principal(3);
        let mut params = default_params();
        params.phase_aprs_bps = [0, 1000, 800, 600, 400, 200];
        let mut state = ProjectState::new(dev, params, 0);
        state.deposit(&user1, 700_000, 10).unwrap();
        state.deposit(&user2, 800_000, 11).unwrap();
        state.fund_reserve(&dev, 800_000).unwrap();
        state.close_phase(&dev, 0, doc("phase-0"), 100).unwrap();
        state.accrue_interest(100 + YEAR_SECONDS).unwrap();
        let claimable1 = state.claimable_interest(&user1);
        let claimable2 = state.claimable_interest(&user2);
        assert!(claimable1 > 0);
        assert!(claimable2 > 0);
        state
            .claim_interest(&user1, claimable1 / 2, 200 + YEAR_SECONDS)
            .unwrap();
        state
            .claim_interest(&user2, claimable2 / 2, 200 + YEAR_SECONDS)
            .unwrap();
    }

    #[test]
    fn revenue_distribution_and_principal_redemption() {
        let dev = principal(1);
        let user = principal(2);
        let mut state = ProjectState::new(dev, default_params(), 0);
        state.deposit(&user, 1_500_000, 10).unwrap();
        state.close_phase(&dev, 0, doc("phase-0"), 20).unwrap();
        state.submit_sales_proceeds(&dev, 1_000_000, 30).unwrap();
        assert_eq!(state.principal_buffer, 1_000_000);
        state.submit_sales_proceeds(&dev, 700_000, 40).unwrap();
        assert!(state.claimable_revenue(&user) > 0);
        let revenue = state.claim_revenue(&user, 50).unwrap();
        assert!(revenue > 0);
        let redeemed = state.withdraw_principal(&user, 700_000, 60).unwrap();
        assert_eq!(redeemed, 700_000);
    }

    #[test]
    fn submit_appraisal_requires_phase_five() {
        let dev = principal(1);
        let investor = principal(2);
        let mut state = ProjectState::new(dev, default_params(), 0);
        state.deposit(&investor, 1_200_000, 10).unwrap();
        state.fund_reserve(&dev, 500_000).unwrap();
        state.close_phase(&dev, 0, doc("phase-0"), 20).unwrap();
        assert!(matches!(
            state.submit_appraisal(&dev, 10, "hash1".into(), 25),
            Err(ProjectError::NotPhaseFive)
        ));
        for phase in 1..=4 {
            state
                .close_phase(
                    &dev,
                    phase,
                    doc(&format!("phase-{phase}")),
                    30 + phase as u64,
                )
                .unwrap();
        }
        assert_eq!(state.current_phase, 5);
        state
            .submit_appraisal(&dev, 40, "hash2".into(), 80)
            .unwrap();
        assert_eq!(state.phase5_percent_complete, 40);
        assert!(matches!(
            state.submit_appraisal(&dev, 39, "hash3".into(), 90),
            Err(ProjectError::PercentBelowLast)
        ));
    }

    #[test]
    fn developer_withdraw_respects_caps() {
        let dev = principal(1);
        let investor = principal(2);
        let mut state = ProjectState::new(dev, default_params(), 0);
        state.deposit(&investor, 1_500_000, 10).unwrap();
        state.fund_reserve(&dev, 500_000).unwrap();
        state.close_phase(&dev, 0, doc("phase-0"), 20).unwrap();
        state.close_phase(&dev, 1, doc("phase-1"), 30).unwrap();
        assert!(matches!(
            state.withdraw_phase_funds(&dev, 500_000, 40),
            Err(ProjectError::ExceedsCaps)
        ));
        state.withdraw_phase_funds(&dev, 400_000, 41).unwrap();
        assert_eq!(state.total_dev_withdrawn, 400_000);
        assert!(matches!(
            state.withdraw_phase_funds(&dev, 10, 42),
            Err(ProjectError::ExceedsCaps)
        ));
    }

    #[test]
    fn refund_after_deadline() {
        let dev = principal(1);
        let investor = principal(2);
        let mut state = ProjectState::new(dev, default_params(), 0);
        state.deposit(&investor, 100_000, 10).unwrap();
        let deadline = state.params.fundraise_deadline;
        assert!(matches!(
            state.refund_if_min_not_met(&investor, deadline - 1),
            Err(ProjectError::RefundUnavailable)
        ));
        let refunded = state
            .refund_if_min_not_met(&investor, deadline + 1)
            .unwrap();
        assert_eq!(refunded, 100_000);
        assert_eq!(state.total_raised, 0);
        assert_eq!(state.total_supply, 0);
    }

    #[test]
    fn registry_registers_and_assigns() {
        let owner = principal(1);
        let creator = principal(2);
        let mut registry = RegistryState::new(owner);
        let listing =
            registry.register_project(&creator, default_params(), "ipfs://meta".into(), 10);
        assert_eq!(listing.id, 1);
        assert_eq!(listing.creator, creator);
        assert_eq!(registry.list().len(), 1);
        registry
            .assign_canisters(&creator, 1, principal(3), principal(4))
            .unwrap();
        let fetched = registry.get(1).unwrap();
        assert_eq!(fetched.project_canister, Some(principal(3)));
        assert_eq!(fetched.token_canister, Some(principal(4)));
    }

    #[test]
    fn registry_requires_creator_or_owner_for_assignment() {
        let owner = principal(1);
        let creator = principal(2);
        let mut registry = RegistryState::new(owner);
        registry.register_project(&creator, default_params(), "ipfs://meta".into(), 10);
        let err = registry.assign_canisters(&principal(9), 1, principal(3), principal(4));
        assert!(matches!(err, Err(ProjectError::NotProjectCreator)));
        registry
            .assign_canisters(&owner, 1, principal(3), principal(4))
            .unwrap();
    }

    #[test]
    fn pause_and_unpause_flow() {
        let dev = principal(1);
        let user = principal(2);
        let mut state = ProjectState::new(dev, default_params(), 0);
        state.pause(&dev).unwrap();
        assert!(matches!(
            state.deposit(&user, 100_000, 5),
            Err(ProjectError::Paused)
        ));
        state.unpause(&dev).unwrap();
        state.deposit(&user, 100_000, 6).unwrap();
    }
}
