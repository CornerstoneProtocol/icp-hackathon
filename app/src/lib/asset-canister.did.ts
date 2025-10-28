import { IDL } from '@dfinity/candid';

// Asset canister Candid interface
// Based on the standard ICP asset canister interface
export const idlFactory = ({ IDL }: { IDL: typeof import('@dfinity/candid').IDL }) => {
  const BatchId = IDL.Nat;
  const ChunkId = IDL.Nat;
  const Key = IDL.Text;
  const Time = IDL.Int;

  const CreateAssetArguments = IDL.Record({
    key: Key,
    content_type: IDL.Text,
    max_age: IDL.Opt(IDL.Nat64),
    headers: IDL.Opt(IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text))),
    enable_aliasing: IDL.Opt(IDL.Bool),
    allow_raw_access: IDL.Opt(IDL.Bool),
  });

  const SetAssetContentArguments = IDL.Record({
    key: Key,
    content_encoding: IDL.Text,
    chunk_ids: IDL.Vec(ChunkId),
    sha256: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const UnsetAssetContentArguments = IDL.Record({
    key: Key,
    content_encoding: IDL.Text,
  });

  const DeleteAssetArguments = IDL.Record({
    key: Key,
  });

  const ClearArguments = IDL.Record({});

  const BatchOperationKind = IDL.Variant({
    CreateAsset: CreateAssetArguments,
    SetAssetContent: SetAssetContentArguments,
    UnsetAssetContent: UnsetAssetContentArguments,
    DeleteAsset: DeleteAssetArguments,
    Clear: ClearArguments,
  });

  const CommitBatchArguments = IDL.Record({
    batch_id: BatchId,
    operations: IDL.Vec(BatchOperationKind),
  });

  const GetArgs = IDL.Record({
    key: Key,
    accept_encodings: IDL.Vec(IDL.Text),
  });

  const EncodedAsset = IDL.Record({
    content: IDL.Vec(IDL.Nat8),
    content_type: IDL.Text,
    content_encoding: IDL.Text,
    total_length: IDL.Nat,
    sha256: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const AssetEncodingDetails = IDL.Record({
    content_encoding: IDL.Text,
    sha256: IDL.Opt(IDL.Vec(IDL.Nat8)),
    length: IDL.Nat,
    modified: Time,
  });

  const AssetDetails = IDL.Record({
    key: Key,
    content_type: IDL.Text,
    encodings: IDL.Vec(AssetEncodingDetails),
  });

  const ListArgs = IDL.Record({});

  const StoreArgs = IDL.Record({
    key: Key,
    content_type: IDL.Text,
    content_encoding: IDL.Text,
    content: IDL.Vec(IDL.Nat8),
    sha256: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const CreateChunkArgs = IDL.Record({
    batch_id: BatchId,
    content: IDL.Vec(IDL.Nat8),
  });

  const CreateChunkResponse = IDL.Record({
    chunk_id: ChunkId,
  });

  return IDL.Service({
    // Retrieve an asset
    get: IDL.Func([GetArgs], [EncodedAsset], ['query']),

    // List all assets
    list: IDL.Func([ListArgs], [IDL.Vec(AssetDetails)], ['query']),

    // Simple store operation (for small files)
    store: IDL.Func([StoreArgs], [], []),

    // Batch operations (for large files)
    create_batch: IDL.Func([], [BatchId], []),
    create_chunk: IDL.Func([CreateChunkArgs], [CreateChunkResponse], []),
    commit_batch: IDL.Func([CommitBatchArguments], [], []),

    // Asset management
    create_asset: IDL.Func([CreateAssetArguments], [], []),
    set_asset_content: IDL.Func([SetAssetContentArguments], [], []),
    unset_asset_content: IDL.Func([UnsetAssetContentArguments], [], []),
    delete_asset: IDL.Func([DeleteAssetArguments], [], []),
    clear: IDL.Func([ClearArguments], [], []),
  });
};

export const init = ({ IDL }: { IDL: typeof import('@dfinity/candid').IDL }) => {
  return [];
};