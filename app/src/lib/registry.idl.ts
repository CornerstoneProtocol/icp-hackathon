import { IDL } from '@dfinity/candid';

// Type definitions matching the Rust structs
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

const ProjectListing = IDL.Record({
  id: IDL.Nat64,
  creator: IDL.Principal,
  project_canister: IDL.Opt(IDL.Principal),
  token_canister: IDL.Opt(IDL.Principal),
  metadata_uri: IDL.Text,
  params: ProjectParams,
  created_at: IDL.Nat64,
});

const InitArgs = IDL.Record({
  owner: IDL.Opt(IDL.Principal),
});

const Result = IDL.Variant({
  Ok: IDL.Null,
  Err: IDL.Text,
});

const ResultListing = IDL.Variant({
  Ok: ProjectListing,
  Err: IDL.Text,
});

export const idlFactory = ({ IDL }: { IDL: typeof import('@dfinity/candid').IDL }) => {
  return IDL.Service({
    // Query methods
    list_projects: IDL.Func([], [IDL.Vec(ProjectListing)], ['query']),
    get_project: IDL.Func([IDL.Nat64], [IDL.Opt(ProjectListing)], ['query']),
    get_project_wasm_size: IDL.Func([], [IDL.Nat], ['query']),

    // Update methods
    register_project: IDL.Func([ProjectParams, IDL.Text], [ResultListing], []),
    assign_canisters: IDL.Func([IDL.Nat64, IDL.Principal, IDL.Principal], [Result], []),
    set_project_wasm: IDL.Func([IDL.Vec(IDL.Nat8)], [Result], []),
  });
};

export const init = ({ IDL }: { IDL: typeof import('@dfinity/candid').IDL }) => {
  return [IDL.Opt(IDL.Record({ owner: IDL.Opt(IDL.Principal) }))];
};