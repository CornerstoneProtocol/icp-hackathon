import { IDL } from '@dfinity/candid';

// Type definitions matching the Rust structs
const DocRecord = IDL.Record({
  doc_types: IDL.Vec(IDL.Text),
  doc_hashes: IDL.Vec(IDL.Text),
  metadata_uris: IDL.Vec(IDL.Text),
  submitted_at: IDL.Nat64,
});

const AppraisalRecord = IDL.Record({
  percent_complete: IDL.Nat8,
  appraisal_hash: IDL.Text,
  submitted_at: IDL.Nat64,
});

const ProjectParams = IDL.Record({
  stablecoin: IDL.Text,
  min_raise: IDL.Nat,
  max_raise: IDL.Nat,
  fundraise_deadline: IDL.Nat64,
  phase_aprs_bps: IDL.Vec(IDL.Nat32),
  phase_durations: IDL.Vec(IDL.Nat64),
  phase_withdraw_caps_bps: IDL.Vec(IDL.Nat32),
  token_name: IDL.Text,
  token_symbol: IDL.Text,
});

const AccountState = IDL.Record({
  balance: IDL.Nat,
  interest_correction: IDL.Int,
  revenue_correction: IDL.Int,
  interest_withdrawn: IDL.Nat,
  revenue_withdrawn: IDL.Nat,
});

const ProjectState = IDL.Record({
  owner: IDL.Principal,
  params: ProjectParams,
  paused: IDL.Bool,
  current_phase: IDL.Nat8,
  last_closed_phase: IDL.Nat8,
  fundraise_closed: IDL.Bool,
  fundraise_successful: IDL.Bool,
  total_raised: IDL.Nat,
  pool_balance: IDL.Nat,
  reserve_balance: IDL.Nat,
  accrual_base: IDL.Nat,
  last_accrual_ts: IDL.Nat64,
  principal_buffer: IDL.Nat,
  principal_redeemed: IDL.Nat,
  total_dev_withdrawn: IDL.Nat,
  phase_withdrawn: IDL.Vec(IDL.Nat),
  phase_docs: IDL.Vec(IDL.Vec(DocRecord)),
  appraisals: IDL.Vec(AppraisalRecord),
  phase5_percent_complete: IDL.Nat8,
  last_appraisal_hash: IDL.Opt(IDL.Text),
  total_supply: IDL.Nat,
  interest_per_share_x18: IDL.Nat,
  revenue_per_share_x18: IDL.Nat,
  accounts: IDL.Vec(IDL.Tuple(IDL.Principal, AccountState)),
});

const InitArgs = IDL.Record({
  params: ProjectParams,
});

const Result = IDL.Variant({
  Ok: IDL.Null,
  Err: IDL.Text,
});

const ResultNat = IDL.Variant({
  Ok: IDL.Nat,
  Err: IDL.Text,
});

export const idlFactory = ({ IDL }: { IDL: typeof import('@dfinity/candid').IDL }) => {
  return IDL.Service({
    // Query methods
    get_state: IDL.Func([], [ProjectState], ['query']),
    claimable_interest: IDL.Func([IDL.Principal], [IDL.Nat], ['query']),
    claimable_revenue: IDL.Func([IDL.Principal], [IDL.Nat], ['query']),
    
    // Update methods
    deposit: IDL.Func([IDL.Nat], [Result], []),
    close_phase: IDL.Func([IDL.Nat8, DocRecord], [Result], []),
    submit_appraisal: IDL.Func([IDL.Nat8, IDL.Text], [Result], []),
    withdraw_phase_funds: IDL.Func([IDL.Nat], [Result], []),
    fund_reserve: IDL.Func([IDL.Nat], [Result], []),
    submit_sales_proceeds: IDL.Func([IDL.Nat], [Result], []),
    claim_interest: IDL.Func([IDL.Nat], [ResultNat], []),
    claim_revenue: IDL.Func([], [ResultNat], []),
    withdraw_principal: IDL.Func([IDL.Nat], [ResultNat], []),
    refund_if_min_not_met: IDL.Func([], [ResultNat], []),
    accrue_interest: IDL.Func([], [Result], []),
    pause: IDL.Func([], [Result], []),
    unpause: IDL.Func([], [Result], []),
    transfer_shares: IDL.Func([IDL.Principal, IDL.Nat], [Result], []),
  });
};

export const init = ({ IDL }: { IDL: typeof import('@dfinity/candid').IDL }) => {
  return [IDL.Record({ params: ProjectParams })];
};