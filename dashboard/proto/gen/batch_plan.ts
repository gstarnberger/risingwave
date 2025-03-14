/* eslint-disable */
import { ColumnIndex, StreamSourceInfo } from "./catalog";
import { BatchQueryEpoch, Buffer, HostAddress, WorkerNode } from "./common";
import { IntervalUnit } from "./data";
import { AggCall, ExprNode, InputRefExpr, ProjectSetSelectItem, TableFunction } from "./expr";
import {
  ColumnCatalog,
  ColumnDesc,
  ColumnOrder,
  Field,
  JoinType,
  joinTypeFromJSON,
  joinTypeToJSON,
  OrderType,
  orderTypeFromJSON,
  orderTypeToJSON,
  StorageTableDesc,
} from "./plan_common";

export const protobufPackage = "batch_plan";

export interface RowSeqScanNode {
  tableDesc: StorageTableDesc | undefined;
  columnIds: number[];
  /**
   * All the ranges need to be read. i.e., they are OR'ed.
   *
   * Empty `scan_ranges` means full table scan.
   */
  scanRanges: ScanRange[];
  /**
   * The partition to read for scan tasks.
   *
   * Will be filled by the scheduler.
   */
  vnodeBitmap:
    | Buffer
    | undefined;
  /** Whether the order on output columns should be preserved. */
  ordered: boolean;
  /** If along with `batch_limit`, `chunk_size` will be set. */
  chunkSize: RowSeqScanNode_ChunkSize | undefined;
}

export interface RowSeqScanNode_ChunkSize {
  chunkSize: number;
}

export interface SysRowSeqScanNode {
  tableId: number;
  columnDescs: ColumnDesc[];
}

/**
 * The range to scan, which specifies a consecutive range of the PK
 * and can represent: (Suppose there are N columns in the PK)
 * - full table scan: Should not occur. Use an empty `Vec<ScanRange>` instead.
 * - index range scan: `eq_conds` includes i (between 0 and N-1, inclusive) values,
 *     and `lower_bound` & `upper_bound` is the range for the (i+1)th column
 * - index point get: `eq_conds` includes N values, and `lower_bound` & `upper_bound` are `None`
 */
export interface ScanRange {
  /** The i-th element represents the value of the i-th PK column. */
  eqConds: Uint8Array[];
  /** The lower bound of the next PK column subsequent to those in `eq_conds`. */
  lowerBound:
    | ScanRange_Bound
    | undefined;
  /** The upper bound of the next PK column subsequent to those in `eq_conds`. */
  upperBound: ScanRange_Bound | undefined;
}

/** `None` represent unbounded. */
export interface ScanRange_Bound {
  value: Uint8Array;
  inclusive: boolean;
}

export interface SourceNode {
  sourceId: number;
  columns: ColumnCatalog[];
  properties: { [key: string]: string };
  split: Uint8Array;
  info: StreamSourceInfo | undefined;
}

export interface SourceNode_PropertiesEntry {
  key: string;
  value: string;
}

export interface ProjectNode {
  selectList: ExprNode[];
}

export interface FilterNode {
  searchCondition: ExprNode | undefined;
}

export interface InsertNode {
  /** Id of the table to perform inserting. */
  tableId: number;
  columnIndices: number[];
  /**
   * An optional field and will be `None` for tables without user-defined pk.
   * The `BatchInsertExecutor` should add a column with NULL value which will
   * be filled in streaming.
   */
  rowIdIndex: ColumnIndex | undefined;
  returning: boolean;
}

export interface DeleteNode {
  /** Id of the table to perform deleting. */
  tableId: number;
  returning: boolean;
}

export interface UpdateNode {
  /** Id of the table to perform updating. */
  tableId: number;
  exprs: ExprNode[];
  returning: boolean;
}

export interface ValuesNode {
  tuples: ValuesNode_ExprTuple[];
  fields: Field[];
}

export interface ValuesNode_ExprTuple {
  cells: ExprNode[];
}

export interface SortNode {
  columnOrders: ColumnOrder[];
}

export interface TopNNode {
  columnOrders: ColumnOrder[];
  limit: number;
  offset: number;
  withTies: boolean;
}

export interface GroupTopNNode {
  columnOrders: ColumnOrder[];
  limit: number;
  offset: number;
  groupKey: number[];
  withTies: boolean;
}

export interface LimitNode {
  limit: number;
  offset: number;
}

export interface NestedLoopJoinNode {
  joinType: JoinType;
  joinCond: ExprNode | undefined;
  outputIndices: number[];
}

export interface HashAggNode {
  groupKey: number[];
  aggCalls: AggCall[];
}

export interface ExpandNode {
  columnSubsets: ExpandNode_Subset[];
}

export interface ExpandNode_Subset {
  columnIndices: number[];
}

export interface ProjectSetNode {
  selectList: ProjectSetSelectItem[];
}

export interface SortAggNode {
  groupKey: ExprNode[];
  aggCalls: AggCall[];
}

export interface HashJoinNode {
  joinType: JoinType;
  leftKey: number[];
  rightKey: number[];
  condition: ExprNode | undefined;
  outputIndices: number[];
  /**
   * Null safe means it treats `null = null` as true.
   * Each key pair can be null safe independently. (left_key, right_key, null_safe)
   */
  nullSafe: boolean[];
}

export interface SortMergeJoinNode {
  joinType: JoinType;
  leftKey: number[];
  rightKey: number[];
  direction: OrderType;
  outputIndices: number[];
}

export interface HopWindowNode {
  timeCol: InputRefExpr | undefined;
  windowSlide: IntervalUnit | undefined;
  windowSize: IntervalUnit | undefined;
  outputIndices: number[];
}

export interface TableFunctionNode {
  tableFunction: TableFunction | undefined;
}

/** Task is a running instance of Stage. */
export interface TaskId {
  queryId: string;
  stageId: number;
  taskId: number;
}

/**
 * Every task will create N buffers (channels) for parent operators to fetch results from,
 * where N is the parallelism of parent stage.
 */
export interface TaskOutputId {
  taskId:
    | TaskId
    | undefined;
  /** The id of output channel to fetch from */
  outputId: number;
}

export interface LocalExecutePlan {
  plan: PlanFragment | undefined;
  epoch: BatchQueryEpoch | undefined;
}

/** ExchangeSource describes where to read results from children operators */
export interface ExchangeSource {
  taskOutputId: TaskOutputId | undefined;
  host: HostAddress | undefined;
  localExecutePlan?: { $case: "plan"; plan: LocalExecutePlan };
}

export interface ExchangeNode {
  sources: ExchangeSource[];
  inputSchema: Field[];
}

export interface MergeSortExchangeNode {
  exchange: ExchangeNode | undefined;
  columnOrders: ColumnOrder[];
}

export interface LocalLookupJoinNode {
  joinType: JoinType;
  condition: ExprNode | undefined;
  outerSideKey: number[];
  innerSideKey: number[];
  lookupPrefixLen: number;
  innerSideTableDesc: StorageTableDesc | undefined;
  innerSideVnodeMapping: number[];
  innerSideColumnIds: number[];
  outputIndices: number[];
  workerNodes: WorkerNode[];
  /**
   * Null safe means it treats `null = null` as true.
   * Each key pair can be null safe independently. (left_key, right_key, null_safe)
   */
  nullSafe: boolean[];
}

/**
 * RFC: A new schedule way for distributed lookup join
 * https://github.com/risingwavelabs/rfcs/pull/6
 */
export interface DistributedLookupJoinNode {
  joinType: JoinType;
  condition: ExprNode | undefined;
  outerSideKey: number[];
  innerSideKey: number[];
  lookupPrefixLen: number;
  innerSideTableDesc: StorageTableDesc | undefined;
  innerSideColumnIds: number[];
  outputIndices: number[];
  /**
   * Null safe means it treats `null = null` as true.
   * Each key pair can be null safe independently. (left_key, right_key, null_safe)
   */
  nullSafe: boolean[];
}

export interface UnionNode {
}

export interface PlanNode {
  children: PlanNode[];
  nodeBody?:
    | { $case: "insert"; insert: InsertNode }
    | { $case: "delete"; delete: DeleteNode }
    | { $case: "update"; update: UpdateNode }
    | { $case: "project"; project: ProjectNode }
    | { $case: "hashAgg"; hashAgg: HashAggNode }
    | { $case: "filter"; filter: FilterNode }
    | { $case: "exchange"; exchange: ExchangeNode }
    | { $case: "sort"; sort: SortNode }
    | { $case: "nestedLoopJoin"; nestedLoopJoin: NestedLoopJoinNode }
    | { $case: "topN"; topN: TopNNode }
    | { $case: "sortAgg"; sortAgg: SortAggNode }
    | { $case: "rowSeqScan"; rowSeqScan: RowSeqScanNode }
    | { $case: "limit"; limit: LimitNode }
    | { $case: "values"; values: ValuesNode }
    | { $case: "hashJoin"; hashJoin: HashJoinNode }
    | { $case: "mergeSortExchange"; mergeSortExchange: MergeSortExchangeNode }
    | { $case: "hopWindow"; hopWindow: HopWindowNode }
    | { $case: "tableFunction"; tableFunction: TableFunctionNode }
    | { $case: "sysRowSeqScan"; sysRowSeqScan: SysRowSeqScanNode }
    | { $case: "expand"; expand: ExpandNode }
    | { $case: "localLookupJoin"; localLookupJoin: LocalLookupJoinNode }
    | { $case: "projectSet"; projectSet: ProjectSetNode }
    | { $case: "union"; union: UnionNode }
    | { $case: "groupTopN"; groupTopN: GroupTopNNode }
    | { $case: "distributedLookupJoin"; distributedLookupJoin: DistributedLookupJoinNode }
    | { $case: "source"; source: SourceNode };
  identity: string;
}

/**
 * ExchangeInfo determines how to distribute results to tasks of next stage.
 *
 * Note that the fragment itself does not know the where are the receivers. Instead, it prepares results in
 * N buffers and wait for parent operators (`Exchange` nodes) to pull data from a specified buffer
 */
export interface ExchangeInfo {
  mode: ExchangeInfo_DistributionMode;
  distribution?: { $case: "broadcastInfo"; broadcastInfo: ExchangeInfo_BroadcastInfo } | {
    $case: "hashInfo";
    hashInfo: ExchangeInfo_HashInfo;
  } | { $case: "consistentHashInfo"; consistentHashInfo: ExchangeInfo_ConsistentHashInfo };
}

export const ExchangeInfo_DistributionMode = {
  /** UNSPECIFIED - No partitioning at all, used for root segment which aggregates query results */
  UNSPECIFIED: "UNSPECIFIED",
  SINGLE: "SINGLE",
  BROADCAST: "BROADCAST",
  HASH: "HASH",
  CONSISTENT_HASH: "CONSISTENT_HASH",
  UNRECOGNIZED: "UNRECOGNIZED",
} as const;

export type ExchangeInfo_DistributionMode =
  typeof ExchangeInfo_DistributionMode[keyof typeof ExchangeInfo_DistributionMode];

export function exchangeInfo_DistributionModeFromJSON(object: any): ExchangeInfo_DistributionMode {
  switch (object) {
    case 0:
    case "UNSPECIFIED":
      return ExchangeInfo_DistributionMode.UNSPECIFIED;
    case 1:
    case "SINGLE":
      return ExchangeInfo_DistributionMode.SINGLE;
    case 2:
    case "BROADCAST":
      return ExchangeInfo_DistributionMode.BROADCAST;
    case 3:
    case "HASH":
      return ExchangeInfo_DistributionMode.HASH;
    case 4:
    case "CONSISTENT_HASH":
      return ExchangeInfo_DistributionMode.CONSISTENT_HASH;
    case -1:
    case "UNRECOGNIZED":
    default:
      return ExchangeInfo_DistributionMode.UNRECOGNIZED;
  }
}

export function exchangeInfo_DistributionModeToJSON(object: ExchangeInfo_DistributionMode): string {
  switch (object) {
    case ExchangeInfo_DistributionMode.UNSPECIFIED:
      return "UNSPECIFIED";
    case ExchangeInfo_DistributionMode.SINGLE:
      return "SINGLE";
    case ExchangeInfo_DistributionMode.BROADCAST:
      return "BROADCAST";
    case ExchangeInfo_DistributionMode.HASH:
      return "HASH";
    case ExchangeInfo_DistributionMode.CONSISTENT_HASH:
      return "CONSISTENT_HASH";
    case ExchangeInfo_DistributionMode.UNRECOGNIZED:
    default:
      return "UNRECOGNIZED";
  }
}

export interface ExchangeInfo_BroadcastInfo {
  count: number;
}

export interface ExchangeInfo_HashInfo {
  outputCount: number;
  key: number[];
}

export interface ExchangeInfo_ConsistentHashInfo {
  /** `vmap` maps virtual node to down stream task id */
  vmap: number[];
  key: number[];
}

export interface PlanFragment {
  root: PlanNode | undefined;
  exchangeInfo: ExchangeInfo | undefined;
}

function createBaseRowSeqScanNode(): RowSeqScanNode {
  return {
    tableDesc: undefined,
    columnIds: [],
    scanRanges: [],
    vnodeBitmap: undefined,
    ordered: false,
    chunkSize: undefined,
  };
}

export const RowSeqScanNode = {
  fromJSON(object: any): RowSeqScanNode {
    return {
      tableDesc: isSet(object.tableDesc) ? StorageTableDesc.fromJSON(object.tableDesc) : undefined,
      columnIds: Array.isArray(object?.columnIds) ? object.columnIds.map((e: any) => Number(e)) : [],
      scanRanges: Array.isArray(object?.scanRanges) ? object.scanRanges.map((e: any) => ScanRange.fromJSON(e)) : [],
      vnodeBitmap: isSet(object.vnodeBitmap) ? Buffer.fromJSON(object.vnodeBitmap) : undefined,
      ordered: isSet(object.ordered) ? Boolean(object.ordered) : false,
      chunkSize: isSet(object.chunkSize) ? RowSeqScanNode_ChunkSize.fromJSON(object.chunkSize) : undefined,
    };
  },

  toJSON(message: RowSeqScanNode): unknown {
    const obj: any = {};
    message.tableDesc !== undefined &&
      (obj.tableDesc = message.tableDesc ? StorageTableDesc.toJSON(message.tableDesc) : undefined);
    if (message.columnIds) {
      obj.columnIds = message.columnIds.map((e) => Math.round(e));
    } else {
      obj.columnIds = [];
    }
    if (message.scanRanges) {
      obj.scanRanges = message.scanRanges.map((e) => e ? ScanRange.toJSON(e) : undefined);
    } else {
      obj.scanRanges = [];
    }
    message.vnodeBitmap !== undefined &&
      (obj.vnodeBitmap = message.vnodeBitmap ? Buffer.toJSON(message.vnodeBitmap) : undefined);
    message.ordered !== undefined && (obj.ordered = message.ordered);
    message.chunkSize !== undefined &&
      (obj.chunkSize = message.chunkSize ? RowSeqScanNode_ChunkSize.toJSON(message.chunkSize) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<RowSeqScanNode>, I>>(object: I): RowSeqScanNode {
    const message = createBaseRowSeqScanNode();
    message.tableDesc = (object.tableDesc !== undefined && object.tableDesc !== null)
      ? StorageTableDesc.fromPartial(object.tableDesc)
      : undefined;
    message.columnIds = object.columnIds?.map((e) => e) || [];
    message.scanRanges = object.scanRanges?.map((e) => ScanRange.fromPartial(e)) || [];
    message.vnodeBitmap = (object.vnodeBitmap !== undefined && object.vnodeBitmap !== null)
      ? Buffer.fromPartial(object.vnodeBitmap)
      : undefined;
    message.ordered = object.ordered ?? false;
    message.chunkSize = (object.chunkSize !== undefined && object.chunkSize !== null)
      ? RowSeqScanNode_ChunkSize.fromPartial(object.chunkSize)
      : undefined;
    return message;
  },
};

function createBaseRowSeqScanNode_ChunkSize(): RowSeqScanNode_ChunkSize {
  return { chunkSize: 0 };
}

export const RowSeqScanNode_ChunkSize = {
  fromJSON(object: any): RowSeqScanNode_ChunkSize {
    return { chunkSize: isSet(object.chunkSize) ? Number(object.chunkSize) : 0 };
  },

  toJSON(message: RowSeqScanNode_ChunkSize): unknown {
    const obj: any = {};
    message.chunkSize !== undefined && (obj.chunkSize = Math.round(message.chunkSize));
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<RowSeqScanNode_ChunkSize>, I>>(object: I): RowSeqScanNode_ChunkSize {
    const message = createBaseRowSeqScanNode_ChunkSize();
    message.chunkSize = object.chunkSize ?? 0;
    return message;
  },
};

function createBaseSysRowSeqScanNode(): SysRowSeqScanNode {
  return { tableId: 0, columnDescs: [] };
}

export const SysRowSeqScanNode = {
  fromJSON(object: any): SysRowSeqScanNode {
    return {
      tableId: isSet(object.tableId) ? Number(object.tableId) : 0,
      columnDescs: Array.isArray(object?.columnDescs) ? object.columnDescs.map((e: any) => ColumnDesc.fromJSON(e)) : [],
    };
  },

  toJSON(message: SysRowSeqScanNode): unknown {
    const obj: any = {};
    message.tableId !== undefined && (obj.tableId = Math.round(message.tableId));
    if (message.columnDescs) {
      obj.columnDescs = message.columnDescs.map((e) => e ? ColumnDesc.toJSON(e) : undefined);
    } else {
      obj.columnDescs = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<SysRowSeqScanNode>, I>>(object: I): SysRowSeqScanNode {
    const message = createBaseSysRowSeqScanNode();
    message.tableId = object.tableId ?? 0;
    message.columnDescs = object.columnDescs?.map((e) => ColumnDesc.fromPartial(e)) || [];
    return message;
  },
};

function createBaseScanRange(): ScanRange {
  return { eqConds: [], lowerBound: undefined, upperBound: undefined };
}

export const ScanRange = {
  fromJSON(object: any): ScanRange {
    return {
      eqConds: Array.isArray(object?.eqConds) ? object.eqConds.map((e: any) => bytesFromBase64(e)) : [],
      lowerBound: isSet(object.lowerBound) ? ScanRange_Bound.fromJSON(object.lowerBound) : undefined,
      upperBound: isSet(object.upperBound) ? ScanRange_Bound.fromJSON(object.upperBound) : undefined,
    };
  },

  toJSON(message: ScanRange): unknown {
    const obj: any = {};
    if (message.eqConds) {
      obj.eqConds = message.eqConds.map((e) => base64FromBytes(e !== undefined ? e : new Uint8Array()));
    } else {
      obj.eqConds = [];
    }
    message.lowerBound !== undefined &&
      (obj.lowerBound = message.lowerBound ? ScanRange_Bound.toJSON(message.lowerBound) : undefined);
    message.upperBound !== undefined &&
      (obj.upperBound = message.upperBound ? ScanRange_Bound.toJSON(message.upperBound) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ScanRange>, I>>(object: I): ScanRange {
    const message = createBaseScanRange();
    message.eqConds = object.eqConds?.map((e) => e) || [];
    message.lowerBound = (object.lowerBound !== undefined && object.lowerBound !== null)
      ? ScanRange_Bound.fromPartial(object.lowerBound)
      : undefined;
    message.upperBound = (object.upperBound !== undefined && object.upperBound !== null)
      ? ScanRange_Bound.fromPartial(object.upperBound)
      : undefined;
    return message;
  },
};

function createBaseScanRange_Bound(): ScanRange_Bound {
  return { value: new Uint8Array(), inclusive: false };
}

export const ScanRange_Bound = {
  fromJSON(object: any): ScanRange_Bound {
    return {
      value: isSet(object.value) ? bytesFromBase64(object.value) : new Uint8Array(),
      inclusive: isSet(object.inclusive) ? Boolean(object.inclusive) : false,
    };
  },

  toJSON(message: ScanRange_Bound): unknown {
    const obj: any = {};
    message.value !== undefined &&
      (obj.value = base64FromBytes(message.value !== undefined ? message.value : new Uint8Array()));
    message.inclusive !== undefined && (obj.inclusive = message.inclusive);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ScanRange_Bound>, I>>(object: I): ScanRange_Bound {
    const message = createBaseScanRange_Bound();
    message.value = object.value ?? new Uint8Array();
    message.inclusive = object.inclusive ?? false;
    return message;
  },
};

function createBaseSourceNode(): SourceNode {
  return { sourceId: 0, columns: [], properties: {}, split: new Uint8Array(), info: undefined };
}

export const SourceNode = {
  fromJSON(object: any): SourceNode {
    return {
      sourceId: isSet(object.sourceId) ? Number(object.sourceId) : 0,
      columns: Array.isArray(object?.columns) ? object.columns.map((e: any) => ColumnCatalog.fromJSON(e)) : [],
      properties: isObject(object.properties)
        ? Object.entries(object.properties).reduce<{ [key: string]: string }>((acc, [key, value]) => {
          acc[key] = String(value);
          return acc;
        }, {})
        : {},
      split: isSet(object.split) ? bytesFromBase64(object.split) : new Uint8Array(),
      info: isSet(object.info) ? StreamSourceInfo.fromJSON(object.info) : undefined,
    };
  },

  toJSON(message: SourceNode): unknown {
    const obj: any = {};
    message.sourceId !== undefined && (obj.sourceId = Math.round(message.sourceId));
    if (message.columns) {
      obj.columns = message.columns.map((e) => e ? ColumnCatalog.toJSON(e) : undefined);
    } else {
      obj.columns = [];
    }
    obj.properties = {};
    if (message.properties) {
      Object.entries(message.properties).forEach(([k, v]) => {
        obj.properties[k] = v;
      });
    }
    message.split !== undefined &&
      (obj.split = base64FromBytes(message.split !== undefined ? message.split : new Uint8Array()));
    message.info !== undefined && (obj.info = message.info ? StreamSourceInfo.toJSON(message.info) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<SourceNode>, I>>(object: I): SourceNode {
    const message = createBaseSourceNode();
    message.sourceId = object.sourceId ?? 0;
    message.columns = object.columns?.map((e) => ColumnCatalog.fromPartial(e)) || [];
    message.properties = Object.entries(object.properties ?? {}).reduce<{ [key: string]: string }>(
      (acc, [key, value]) => {
        if (value !== undefined) {
          acc[key] = String(value);
        }
        return acc;
      },
      {},
    );
    message.split = object.split ?? new Uint8Array();
    message.info = (object.info !== undefined && object.info !== null)
      ? StreamSourceInfo.fromPartial(object.info)
      : undefined;
    return message;
  },
};

function createBaseSourceNode_PropertiesEntry(): SourceNode_PropertiesEntry {
  return { key: "", value: "" };
}

export const SourceNode_PropertiesEntry = {
  fromJSON(object: any): SourceNode_PropertiesEntry {
    return { key: isSet(object.key) ? String(object.key) : "", value: isSet(object.value) ? String(object.value) : "" };
  },

  toJSON(message: SourceNode_PropertiesEntry): unknown {
    const obj: any = {};
    message.key !== undefined && (obj.key = message.key);
    message.value !== undefined && (obj.value = message.value);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<SourceNode_PropertiesEntry>, I>>(object: I): SourceNode_PropertiesEntry {
    const message = createBaseSourceNode_PropertiesEntry();
    message.key = object.key ?? "";
    message.value = object.value ?? "";
    return message;
  },
};

function createBaseProjectNode(): ProjectNode {
  return { selectList: [] };
}

export const ProjectNode = {
  fromJSON(object: any): ProjectNode {
    return {
      selectList: Array.isArray(object?.selectList) ? object.selectList.map((e: any) => ExprNode.fromJSON(e)) : [],
    };
  },

  toJSON(message: ProjectNode): unknown {
    const obj: any = {};
    if (message.selectList) {
      obj.selectList = message.selectList.map((e) => e ? ExprNode.toJSON(e) : undefined);
    } else {
      obj.selectList = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ProjectNode>, I>>(object: I): ProjectNode {
    const message = createBaseProjectNode();
    message.selectList = object.selectList?.map((e) => ExprNode.fromPartial(e)) || [];
    return message;
  },
};

function createBaseFilterNode(): FilterNode {
  return { searchCondition: undefined };
}

export const FilterNode = {
  fromJSON(object: any): FilterNode {
    return { searchCondition: isSet(object.searchCondition) ? ExprNode.fromJSON(object.searchCondition) : undefined };
  },

  toJSON(message: FilterNode): unknown {
    const obj: any = {};
    message.searchCondition !== undefined &&
      (obj.searchCondition = message.searchCondition ? ExprNode.toJSON(message.searchCondition) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<FilterNode>, I>>(object: I): FilterNode {
    const message = createBaseFilterNode();
    message.searchCondition = (object.searchCondition !== undefined && object.searchCondition !== null)
      ? ExprNode.fromPartial(object.searchCondition)
      : undefined;
    return message;
  },
};

function createBaseInsertNode(): InsertNode {
  return { tableId: 0, columnIndices: [], rowIdIndex: undefined, returning: false };
}

export const InsertNode = {
  fromJSON(object: any): InsertNode {
    return {
      tableId: isSet(object.tableId) ? Number(object.tableId) : 0,
      columnIndices: Array.isArray(object?.columnIndices) ? object.columnIndices.map((e: any) => Number(e)) : [],
      rowIdIndex: isSet(object.rowIdIndex) ? ColumnIndex.fromJSON(object.rowIdIndex) : undefined,
      returning: isSet(object.returning) ? Boolean(object.returning) : false,
    };
  },

  toJSON(message: InsertNode): unknown {
    const obj: any = {};
    message.tableId !== undefined && (obj.tableId = Math.round(message.tableId));
    if (message.columnIndices) {
      obj.columnIndices = message.columnIndices.map((e) => Math.round(e));
    } else {
      obj.columnIndices = [];
    }
    message.rowIdIndex !== undefined &&
      (obj.rowIdIndex = message.rowIdIndex ? ColumnIndex.toJSON(message.rowIdIndex) : undefined);
    message.returning !== undefined && (obj.returning = message.returning);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<InsertNode>, I>>(object: I): InsertNode {
    const message = createBaseInsertNode();
    message.tableId = object.tableId ?? 0;
    message.columnIndices = object.columnIndices?.map((e) => e) || [];
    message.rowIdIndex = (object.rowIdIndex !== undefined && object.rowIdIndex !== null)
      ? ColumnIndex.fromPartial(object.rowIdIndex)
      : undefined;
    message.returning = object.returning ?? false;
    return message;
  },
};

function createBaseDeleteNode(): DeleteNode {
  return { tableId: 0, returning: false };
}

export const DeleteNode = {
  fromJSON(object: any): DeleteNode {
    return {
      tableId: isSet(object.tableId) ? Number(object.tableId) : 0,
      returning: isSet(object.returning) ? Boolean(object.returning) : false,
    };
  },

  toJSON(message: DeleteNode): unknown {
    const obj: any = {};
    message.tableId !== undefined && (obj.tableId = Math.round(message.tableId));
    message.returning !== undefined && (obj.returning = message.returning);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<DeleteNode>, I>>(object: I): DeleteNode {
    const message = createBaseDeleteNode();
    message.tableId = object.tableId ?? 0;
    message.returning = object.returning ?? false;
    return message;
  },
};

function createBaseUpdateNode(): UpdateNode {
  return { tableId: 0, exprs: [], returning: false };
}

export const UpdateNode = {
  fromJSON(object: any): UpdateNode {
    return {
      tableId: isSet(object.tableId) ? Number(object.tableId) : 0,
      exprs: Array.isArray(object?.exprs) ? object.exprs.map((e: any) => ExprNode.fromJSON(e)) : [],
      returning: isSet(object.returning) ? Boolean(object.returning) : false,
    };
  },

  toJSON(message: UpdateNode): unknown {
    const obj: any = {};
    message.tableId !== undefined && (obj.tableId = Math.round(message.tableId));
    if (message.exprs) {
      obj.exprs = message.exprs.map((e) => e ? ExprNode.toJSON(e) : undefined);
    } else {
      obj.exprs = [];
    }
    message.returning !== undefined && (obj.returning = message.returning);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<UpdateNode>, I>>(object: I): UpdateNode {
    const message = createBaseUpdateNode();
    message.tableId = object.tableId ?? 0;
    message.exprs = object.exprs?.map((e) => ExprNode.fromPartial(e)) || [];
    message.returning = object.returning ?? false;
    return message;
  },
};

function createBaseValuesNode(): ValuesNode {
  return { tuples: [], fields: [] };
}

export const ValuesNode = {
  fromJSON(object: any): ValuesNode {
    return {
      tuples: Array.isArray(object?.tuples) ? object.tuples.map((e: any) => ValuesNode_ExprTuple.fromJSON(e)) : [],
      fields: Array.isArray(object?.fields) ? object.fields.map((e: any) => Field.fromJSON(e)) : [],
    };
  },

  toJSON(message: ValuesNode): unknown {
    const obj: any = {};
    if (message.tuples) {
      obj.tuples = message.tuples.map((e) => e ? ValuesNode_ExprTuple.toJSON(e) : undefined);
    } else {
      obj.tuples = [];
    }
    if (message.fields) {
      obj.fields = message.fields.map((e) => e ? Field.toJSON(e) : undefined);
    } else {
      obj.fields = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ValuesNode>, I>>(object: I): ValuesNode {
    const message = createBaseValuesNode();
    message.tuples = object.tuples?.map((e) => ValuesNode_ExprTuple.fromPartial(e)) || [];
    message.fields = object.fields?.map((e) => Field.fromPartial(e)) || [];
    return message;
  },
};

function createBaseValuesNode_ExprTuple(): ValuesNode_ExprTuple {
  return { cells: [] };
}

export const ValuesNode_ExprTuple = {
  fromJSON(object: any): ValuesNode_ExprTuple {
    return { cells: Array.isArray(object?.cells) ? object.cells.map((e: any) => ExprNode.fromJSON(e)) : [] };
  },

  toJSON(message: ValuesNode_ExprTuple): unknown {
    const obj: any = {};
    if (message.cells) {
      obj.cells = message.cells.map((e) => e ? ExprNode.toJSON(e) : undefined);
    } else {
      obj.cells = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ValuesNode_ExprTuple>, I>>(object: I): ValuesNode_ExprTuple {
    const message = createBaseValuesNode_ExprTuple();
    message.cells = object.cells?.map((e) => ExprNode.fromPartial(e)) || [];
    return message;
  },
};

function createBaseSortNode(): SortNode {
  return { columnOrders: [] };
}

export const SortNode = {
  fromJSON(object: any): SortNode {
    return {
      columnOrders: Array.isArray(object?.columnOrders)
        ? object.columnOrders.map((e: any) => ColumnOrder.fromJSON(e))
        : [],
    };
  },

  toJSON(message: SortNode): unknown {
    const obj: any = {};
    if (message.columnOrders) {
      obj.columnOrders = message.columnOrders.map((e) => e ? ColumnOrder.toJSON(e) : undefined);
    } else {
      obj.columnOrders = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<SortNode>, I>>(object: I): SortNode {
    const message = createBaseSortNode();
    message.columnOrders = object.columnOrders?.map((e) => ColumnOrder.fromPartial(e)) || [];
    return message;
  },
};

function createBaseTopNNode(): TopNNode {
  return { columnOrders: [], limit: 0, offset: 0, withTies: false };
}

export const TopNNode = {
  fromJSON(object: any): TopNNode {
    return {
      columnOrders: Array.isArray(object?.columnOrders)
        ? object.columnOrders.map((e: any) => ColumnOrder.fromJSON(e))
        : [],
      limit: isSet(object.limit) ? Number(object.limit) : 0,
      offset: isSet(object.offset) ? Number(object.offset) : 0,
      withTies: isSet(object.withTies) ? Boolean(object.withTies) : false,
    };
  },

  toJSON(message: TopNNode): unknown {
    const obj: any = {};
    if (message.columnOrders) {
      obj.columnOrders = message.columnOrders.map((e) => e ? ColumnOrder.toJSON(e) : undefined);
    } else {
      obj.columnOrders = [];
    }
    message.limit !== undefined && (obj.limit = Math.round(message.limit));
    message.offset !== undefined && (obj.offset = Math.round(message.offset));
    message.withTies !== undefined && (obj.withTies = message.withTies);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<TopNNode>, I>>(object: I): TopNNode {
    const message = createBaseTopNNode();
    message.columnOrders = object.columnOrders?.map((e) => ColumnOrder.fromPartial(e)) || [];
    message.limit = object.limit ?? 0;
    message.offset = object.offset ?? 0;
    message.withTies = object.withTies ?? false;
    return message;
  },
};

function createBaseGroupTopNNode(): GroupTopNNode {
  return { columnOrders: [], limit: 0, offset: 0, groupKey: [], withTies: false };
}

export const GroupTopNNode = {
  fromJSON(object: any): GroupTopNNode {
    return {
      columnOrders: Array.isArray(object?.columnOrders)
        ? object.columnOrders.map((e: any) => ColumnOrder.fromJSON(e))
        : [],
      limit: isSet(object.limit) ? Number(object.limit) : 0,
      offset: isSet(object.offset) ? Number(object.offset) : 0,
      groupKey: Array.isArray(object?.groupKey)
        ? object.groupKey.map((e: any) => Number(e))
        : [],
      withTies: isSet(object.withTies) ? Boolean(object.withTies) : false,
    };
  },

  toJSON(message: GroupTopNNode): unknown {
    const obj: any = {};
    if (message.columnOrders) {
      obj.columnOrders = message.columnOrders.map((e) => e ? ColumnOrder.toJSON(e) : undefined);
    } else {
      obj.columnOrders = [];
    }
    message.limit !== undefined && (obj.limit = Math.round(message.limit));
    message.offset !== undefined && (obj.offset = Math.round(message.offset));
    if (message.groupKey) {
      obj.groupKey = message.groupKey.map((e) => Math.round(e));
    } else {
      obj.groupKey = [];
    }
    message.withTies !== undefined && (obj.withTies = message.withTies);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<GroupTopNNode>, I>>(object: I): GroupTopNNode {
    const message = createBaseGroupTopNNode();
    message.columnOrders = object.columnOrders?.map((e) => ColumnOrder.fromPartial(e)) || [];
    message.limit = object.limit ?? 0;
    message.offset = object.offset ?? 0;
    message.groupKey = object.groupKey?.map((e) => e) || [];
    message.withTies = object.withTies ?? false;
    return message;
  },
};

function createBaseLimitNode(): LimitNode {
  return { limit: 0, offset: 0 };
}

export const LimitNode = {
  fromJSON(object: any): LimitNode {
    return {
      limit: isSet(object.limit) ? Number(object.limit) : 0,
      offset: isSet(object.offset) ? Number(object.offset) : 0,
    };
  },

  toJSON(message: LimitNode): unknown {
    const obj: any = {};
    message.limit !== undefined && (obj.limit = Math.round(message.limit));
    message.offset !== undefined && (obj.offset = Math.round(message.offset));
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<LimitNode>, I>>(object: I): LimitNode {
    const message = createBaseLimitNode();
    message.limit = object.limit ?? 0;
    message.offset = object.offset ?? 0;
    return message;
  },
};

function createBaseNestedLoopJoinNode(): NestedLoopJoinNode {
  return { joinType: JoinType.UNSPECIFIED, joinCond: undefined, outputIndices: [] };
}

export const NestedLoopJoinNode = {
  fromJSON(object: any): NestedLoopJoinNode {
    return {
      joinType: isSet(object.joinType) ? joinTypeFromJSON(object.joinType) : JoinType.UNSPECIFIED,
      joinCond: isSet(object.joinCond) ? ExprNode.fromJSON(object.joinCond) : undefined,
      outputIndices: Array.isArray(object?.outputIndices) ? object.outputIndices.map((e: any) => Number(e)) : [],
    };
  },

  toJSON(message: NestedLoopJoinNode): unknown {
    const obj: any = {};
    message.joinType !== undefined && (obj.joinType = joinTypeToJSON(message.joinType));
    message.joinCond !== undefined && (obj.joinCond = message.joinCond ? ExprNode.toJSON(message.joinCond) : undefined);
    if (message.outputIndices) {
      obj.outputIndices = message.outputIndices.map((e) => Math.round(e));
    } else {
      obj.outputIndices = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<NestedLoopJoinNode>, I>>(object: I): NestedLoopJoinNode {
    const message = createBaseNestedLoopJoinNode();
    message.joinType = object.joinType ?? JoinType.UNSPECIFIED;
    message.joinCond = (object.joinCond !== undefined && object.joinCond !== null)
      ? ExprNode.fromPartial(object.joinCond)
      : undefined;
    message.outputIndices = object.outputIndices?.map((e) => e) || [];
    return message;
  },
};

function createBaseHashAggNode(): HashAggNode {
  return { groupKey: [], aggCalls: [] };
}

export const HashAggNode = {
  fromJSON(object: any): HashAggNode {
    return {
      groupKey: Array.isArray(object?.groupKey) ? object.groupKey.map((e: any) => Number(e)) : [],
      aggCalls: Array.isArray(object?.aggCalls) ? object.aggCalls.map((e: any) => AggCall.fromJSON(e)) : [],
    };
  },

  toJSON(message: HashAggNode): unknown {
    const obj: any = {};
    if (message.groupKey) {
      obj.groupKey = message.groupKey.map((e) => Math.round(e));
    } else {
      obj.groupKey = [];
    }
    if (message.aggCalls) {
      obj.aggCalls = message.aggCalls.map((e) => e ? AggCall.toJSON(e) : undefined);
    } else {
      obj.aggCalls = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<HashAggNode>, I>>(object: I): HashAggNode {
    const message = createBaseHashAggNode();
    message.groupKey = object.groupKey?.map((e) => e) || [];
    message.aggCalls = object.aggCalls?.map((e) => AggCall.fromPartial(e)) || [];
    return message;
  },
};

function createBaseExpandNode(): ExpandNode {
  return { columnSubsets: [] };
}

export const ExpandNode = {
  fromJSON(object: any): ExpandNode {
    return {
      columnSubsets: Array.isArray(object?.columnSubsets)
        ? object.columnSubsets.map((e: any) => ExpandNode_Subset.fromJSON(e))
        : [],
    };
  },

  toJSON(message: ExpandNode): unknown {
    const obj: any = {};
    if (message.columnSubsets) {
      obj.columnSubsets = message.columnSubsets.map((e) => e ? ExpandNode_Subset.toJSON(e) : undefined);
    } else {
      obj.columnSubsets = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ExpandNode>, I>>(object: I): ExpandNode {
    const message = createBaseExpandNode();
    message.columnSubsets = object.columnSubsets?.map((e) => ExpandNode_Subset.fromPartial(e)) || [];
    return message;
  },
};

function createBaseExpandNode_Subset(): ExpandNode_Subset {
  return { columnIndices: [] };
}

export const ExpandNode_Subset = {
  fromJSON(object: any): ExpandNode_Subset {
    return {
      columnIndices: Array.isArray(object?.columnIndices) ? object.columnIndices.map((e: any) => Number(e)) : [],
    };
  },

  toJSON(message: ExpandNode_Subset): unknown {
    const obj: any = {};
    if (message.columnIndices) {
      obj.columnIndices = message.columnIndices.map((e) => Math.round(e));
    } else {
      obj.columnIndices = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ExpandNode_Subset>, I>>(object: I): ExpandNode_Subset {
    const message = createBaseExpandNode_Subset();
    message.columnIndices = object.columnIndices?.map((e) => e) || [];
    return message;
  },
};

function createBaseProjectSetNode(): ProjectSetNode {
  return { selectList: [] };
}

export const ProjectSetNode = {
  fromJSON(object: any): ProjectSetNode {
    return {
      selectList: Array.isArray(object?.selectList)
        ? object.selectList.map((e: any) => ProjectSetSelectItem.fromJSON(e))
        : [],
    };
  },

  toJSON(message: ProjectSetNode): unknown {
    const obj: any = {};
    if (message.selectList) {
      obj.selectList = message.selectList.map((e) => e ? ProjectSetSelectItem.toJSON(e) : undefined);
    } else {
      obj.selectList = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ProjectSetNode>, I>>(object: I): ProjectSetNode {
    const message = createBaseProjectSetNode();
    message.selectList = object.selectList?.map((e) => ProjectSetSelectItem.fromPartial(e)) || [];
    return message;
  },
};

function createBaseSortAggNode(): SortAggNode {
  return { groupKey: [], aggCalls: [] };
}

export const SortAggNode = {
  fromJSON(object: any): SortAggNode {
    return {
      groupKey: Array.isArray(object?.groupKey) ? object.groupKey.map((e: any) => ExprNode.fromJSON(e)) : [],
      aggCalls: Array.isArray(object?.aggCalls) ? object.aggCalls.map((e: any) => AggCall.fromJSON(e)) : [],
    };
  },

  toJSON(message: SortAggNode): unknown {
    const obj: any = {};
    if (message.groupKey) {
      obj.groupKey = message.groupKey.map((e) => e ? ExprNode.toJSON(e) : undefined);
    } else {
      obj.groupKey = [];
    }
    if (message.aggCalls) {
      obj.aggCalls = message.aggCalls.map((e) => e ? AggCall.toJSON(e) : undefined);
    } else {
      obj.aggCalls = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<SortAggNode>, I>>(object: I): SortAggNode {
    const message = createBaseSortAggNode();
    message.groupKey = object.groupKey?.map((e) => ExprNode.fromPartial(e)) || [];
    message.aggCalls = object.aggCalls?.map((e) => AggCall.fromPartial(e)) || [];
    return message;
  },
};

function createBaseHashJoinNode(): HashJoinNode {
  return {
    joinType: JoinType.UNSPECIFIED,
    leftKey: [],
    rightKey: [],
    condition: undefined,
    outputIndices: [],
    nullSafe: [],
  };
}

export const HashJoinNode = {
  fromJSON(object: any): HashJoinNode {
    return {
      joinType: isSet(object.joinType) ? joinTypeFromJSON(object.joinType) : JoinType.UNSPECIFIED,
      leftKey: Array.isArray(object?.leftKey) ? object.leftKey.map((e: any) => Number(e)) : [],
      rightKey: Array.isArray(object?.rightKey) ? object.rightKey.map((e: any) => Number(e)) : [],
      condition: isSet(object.condition) ? ExprNode.fromJSON(object.condition) : undefined,
      outputIndices: Array.isArray(object?.outputIndices) ? object.outputIndices.map((e: any) => Number(e)) : [],
      nullSafe: Array.isArray(object?.nullSafe) ? object.nullSafe.map((e: any) => Boolean(e)) : [],
    };
  },

  toJSON(message: HashJoinNode): unknown {
    const obj: any = {};
    message.joinType !== undefined && (obj.joinType = joinTypeToJSON(message.joinType));
    if (message.leftKey) {
      obj.leftKey = message.leftKey.map((e) => Math.round(e));
    } else {
      obj.leftKey = [];
    }
    if (message.rightKey) {
      obj.rightKey = message.rightKey.map((e) => Math.round(e));
    } else {
      obj.rightKey = [];
    }
    message.condition !== undefined &&
      (obj.condition = message.condition ? ExprNode.toJSON(message.condition) : undefined);
    if (message.outputIndices) {
      obj.outputIndices = message.outputIndices.map((e) => Math.round(e));
    } else {
      obj.outputIndices = [];
    }
    if (message.nullSafe) {
      obj.nullSafe = message.nullSafe.map((e) => e);
    } else {
      obj.nullSafe = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<HashJoinNode>, I>>(object: I): HashJoinNode {
    const message = createBaseHashJoinNode();
    message.joinType = object.joinType ?? JoinType.UNSPECIFIED;
    message.leftKey = object.leftKey?.map((e) => e) || [];
    message.rightKey = object.rightKey?.map((e) => e) || [];
    message.condition = (object.condition !== undefined && object.condition !== null)
      ? ExprNode.fromPartial(object.condition)
      : undefined;
    message.outputIndices = object.outputIndices?.map((e) => e) || [];
    message.nullSafe = object.nullSafe?.map((e) => e) || [];
    return message;
  },
};

function createBaseSortMergeJoinNode(): SortMergeJoinNode {
  return {
    joinType: JoinType.UNSPECIFIED,
    leftKey: [],
    rightKey: [],
    direction: OrderType.ORDER_UNSPECIFIED,
    outputIndices: [],
  };
}

export const SortMergeJoinNode = {
  fromJSON(object: any): SortMergeJoinNode {
    return {
      joinType: isSet(object.joinType) ? joinTypeFromJSON(object.joinType) : JoinType.UNSPECIFIED,
      leftKey: Array.isArray(object?.leftKey) ? object.leftKey.map((e: any) => Number(e)) : [],
      rightKey: Array.isArray(object?.rightKey) ? object.rightKey.map((e: any) => Number(e)) : [],
      direction: isSet(object.direction) ? orderTypeFromJSON(object.direction) : OrderType.ORDER_UNSPECIFIED,
      outputIndices: Array.isArray(object?.outputIndices) ? object.outputIndices.map((e: any) => Number(e)) : [],
    };
  },

  toJSON(message: SortMergeJoinNode): unknown {
    const obj: any = {};
    message.joinType !== undefined && (obj.joinType = joinTypeToJSON(message.joinType));
    if (message.leftKey) {
      obj.leftKey = message.leftKey.map((e) => Math.round(e));
    } else {
      obj.leftKey = [];
    }
    if (message.rightKey) {
      obj.rightKey = message.rightKey.map((e) => Math.round(e));
    } else {
      obj.rightKey = [];
    }
    message.direction !== undefined && (obj.direction = orderTypeToJSON(message.direction));
    if (message.outputIndices) {
      obj.outputIndices = message.outputIndices.map((e) => Math.round(e));
    } else {
      obj.outputIndices = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<SortMergeJoinNode>, I>>(object: I): SortMergeJoinNode {
    const message = createBaseSortMergeJoinNode();
    message.joinType = object.joinType ?? JoinType.UNSPECIFIED;
    message.leftKey = object.leftKey?.map((e) => e) || [];
    message.rightKey = object.rightKey?.map((e) => e) || [];
    message.direction = object.direction ?? OrderType.ORDER_UNSPECIFIED;
    message.outputIndices = object.outputIndices?.map((e) => e) || [];
    return message;
  },
};

function createBaseHopWindowNode(): HopWindowNode {
  return { timeCol: undefined, windowSlide: undefined, windowSize: undefined, outputIndices: [] };
}

export const HopWindowNode = {
  fromJSON(object: any): HopWindowNode {
    return {
      timeCol: isSet(object.timeCol) ? InputRefExpr.fromJSON(object.timeCol) : undefined,
      windowSlide: isSet(object.windowSlide) ? IntervalUnit.fromJSON(object.windowSlide) : undefined,
      windowSize: isSet(object.windowSize) ? IntervalUnit.fromJSON(object.windowSize) : undefined,
      outputIndices: Array.isArray(object?.outputIndices) ? object.outputIndices.map((e: any) => Number(e)) : [],
    };
  },

  toJSON(message: HopWindowNode): unknown {
    const obj: any = {};
    message.timeCol !== undefined && (obj.timeCol = message.timeCol ? InputRefExpr.toJSON(message.timeCol) : undefined);
    message.windowSlide !== undefined &&
      (obj.windowSlide = message.windowSlide ? IntervalUnit.toJSON(message.windowSlide) : undefined);
    message.windowSize !== undefined &&
      (obj.windowSize = message.windowSize ? IntervalUnit.toJSON(message.windowSize) : undefined);
    if (message.outputIndices) {
      obj.outputIndices = message.outputIndices.map((e) => Math.round(e));
    } else {
      obj.outputIndices = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<HopWindowNode>, I>>(object: I): HopWindowNode {
    const message = createBaseHopWindowNode();
    message.timeCol = (object.timeCol !== undefined && object.timeCol !== null)
      ? InputRefExpr.fromPartial(object.timeCol)
      : undefined;
    message.windowSlide = (object.windowSlide !== undefined && object.windowSlide !== null)
      ? IntervalUnit.fromPartial(object.windowSlide)
      : undefined;
    message.windowSize = (object.windowSize !== undefined && object.windowSize !== null)
      ? IntervalUnit.fromPartial(object.windowSize)
      : undefined;
    message.outputIndices = object.outputIndices?.map((e) => e) || [];
    return message;
  },
};

function createBaseTableFunctionNode(): TableFunctionNode {
  return { tableFunction: undefined };
}

export const TableFunctionNode = {
  fromJSON(object: any): TableFunctionNode {
    return { tableFunction: isSet(object.tableFunction) ? TableFunction.fromJSON(object.tableFunction) : undefined };
  },

  toJSON(message: TableFunctionNode): unknown {
    const obj: any = {};
    message.tableFunction !== undefined &&
      (obj.tableFunction = message.tableFunction ? TableFunction.toJSON(message.tableFunction) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<TableFunctionNode>, I>>(object: I): TableFunctionNode {
    const message = createBaseTableFunctionNode();
    message.tableFunction = (object.tableFunction !== undefined && object.tableFunction !== null)
      ? TableFunction.fromPartial(object.tableFunction)
      : undefined;
    return message;
  },
};

function createBaseTaskId(): TaskId {
  return { queryId: "", stageId: 0, taskId: 0 };
}

export const TaskId = {
  fromJSON(object: any): TaskId {
    return {
      queryId: isSet(object.queryId) ? String(object.queryId) : "",
      stageId: isSet(object.stageId) ? Number(object.stageId) : 0,
      taskId: isSet(object.taskId) ? Number(object.taskId) : 0,
    };
  },

  toJSON(message: TaskId): unknown {
    const obj: any = {};
    message.queryId !== undefined && (obj.queryId = message.queryId);
    message.stageId !== undefined && (obj.stageId = Math.round(message.stageId));
    message.taskId !== undefined && (obj.taskId = Math.round(message.taskId));
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<TaskId>, I>>(object: I): TaskId {
    const message = createBaseTaskId();
    message.queryId = object.queryId ?? "";
    message.stageId = object.stageId ?? 0;
    message.taskId = object.taskId ?? 0;
    return message;
  },
};

function createBaseTaskOutputId(): TaskOutputId {
  return { taskId: undefined, outputId: 0 };
}

export const TaskOutputId = {
  fromJSON(object: any): TaskOutputId {
    return {
      taskId: isSet(object.taskId) ? TaskId.fromJSON(object.taskId) : undefined,
      outputId: isSet(object.outputId) ? Number(object.outputId) : 0,
    };
  },

  toJSON(message: TaskOutputId): unknown {
    const obj: any = {};
    message.taskId !== undefined && (obj.taskId = message.taskId ? TaskId.toJSON(message.taskId) : undefined);
    message.outputId !== undefined && (obj.outputId = Math.round(message.outputId));
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<TaskOutputId>, I>>(object: I): TaskOutputId {
    const message = createBaseTaskOutputId();
    message.taskId = (object.taskId !== undefined && object.taskId !== null)
      ? TaskId.fromPartial(object.taskId)
      : undefined;
    message.outputId = object.outputId ?? 0;
    return message;
  },
};

function createBaseLocalExecutePlan(): LocalExecutePlan {
  return { plan: undefined, epoch: undefined };
}

export const LocalExecutePlan = {
  fromJSON(object: any): LocalExecutePlan {
    return {
      plan: isSet(object.plan) ? PlanFragment.fromJSON(object.plan) : undefined,
      epoch: isSet(object.epoch) ? BatchQueryEpoch.fromJSON(object.epoch) : undefined,
    };
  },

  toJSON(message: LocalExecutePlan): unknown {
    const obj: any = {};
    message.plan !== undefined && (obj.plan = message.plan ? PlanFragment.toJSON(message.plan) : undefined);
    message.epoch !== undefined && (obj.epoch = message.epoch ? BatchQueryEpoch.toJSON(message.epoch) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<LocalExecutePlan>, I>>(object: I): LocalExecutePlan {
    const message = createBaseLocalExecutePlan();
    message.plan = (object.plan !== undefined && object.plan !== null)
      ? PlanFragment.fromPartial(object.plan)
      : undefined;
    message.epoch = (object.epoch !== undefined && object.epoch !== null)
      ? BatchQueryEpoch.fromPartial(object.epoch)
      : undefined;
    return message;
  },
};

function createBaseExchangeSource(): ExchangeSource {
  return { taskOutputId: undefined, host: undefined, localExecutePlan: undefined };
}

export const ExchangeSource = {
  fromJSON(object: any): ExchangeSource {
    return {
      taskOutputId: isSet(object.taskOutputId) ? TaskOutputId.fromJSON(object.taskOutputId) : undefined,
      host: isSet(object.host) ? HostAddress.fromJSON(object.host) : undefined,
      localExecutePlan: isSet(object.plan)
        ? { $case: "plan", plan: LocalExecutePlan.fromJSON(object.plan) }
        : undefined,
    };
  },

  toJSON(message: ExchangeSource): unknown {
    const obj: any = {};
    message.taskOutputId !== undefined &&
      (obj.taskOutputId = message.taskOutputId ? TaskOutputId.toJSON(message.taskOutputId) : undefined);
    message.host !== undefined && (obj.host = message.host ? HostAddress.toJSON(message.host) : undefined);
    message.localExecutePlan?.$case === "plan" &&
      (obj.plan = message.localExecutePlan?.plan ? LocalExecutePlan.toJSON(message.localExecutePlan?.plan) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ExchangeSource>, I>>(object: I): ExchangeSource {
    const message = createBaseExchangeSource();
    message.taskOutputId = (object.taskOutputId !== undefined && object.taskOutputId !== null)
      ? TaskOutputId.fromPartial(object.taskOutputId)
      : undefined;
    message.host = (object.host !== undefined && object.host !== null)
      ? HostAddress.fromPartial(object.host)
      : undefined;
    if (
      object.localExecutePlan?.$case === "plan" &&
      object.localExecutePlan?.plan !== undefined &&
      object.localExecutePlan?.plan !== null
    ) {
      message.localExecutePlan = { $case: "plan", plan: LocalExecutePlan.fromPartial(object.localExecutePlan.plan) };
    }
    return message;
  },
};

function createBaseExchangeNode(): ExchangeNode {
  return { sources: [], inputSchema: [] };
}

export const ExchangeNode = {
  fromJSON(object: any): ExchangeNode {
    return {
      sources: Array.isArray(object?.sources) ? object.sources.map((e: any) => ExchangeSource.fromJSON(e)) : [],
      inputSchema: Array.isArray(object?.inputSchema) ? object.inputSchema.map((e: any) => Field.fromJSON(e)) : [],
    };
  },

  toJSON(message: ExchangeNode): unknown {
    const obj: any = {};
    if (message.sources) {
      obj.sources = message.sources.map((e) => e ? ExchangeSource.toJSON(e) : undefined);
    } else {
      obj.sources = [];
    }
    if (message.inputSchema) {
      obj.inputSchema = message.inputSchema.map((e) => e ? Field.toJSON(e) : undefined);
    } else {
      obj.inputSchema = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ExchangeNode>, I>>(object: I): ExchangeNode {
    const message = createBaseExchangeNode();
    message.sources = object.sources?.map((e) => ExchangeSource.fromPartial(e)) || [];
    message.inputSchema = object.inputSchema?.map((e) => Field.fromPartial(e)) || [];
    return message;
  },
};

function createBaseMergeSortExchangeNode(): MergeSortExchangeNode {
  return { exchange: undefined, columnOrders: [] };
}

export const MergeSortExchangeNode = {
  fromJSON(object: any): MergeSortExchangeNode {
    return {
      exchange: isSet(object.exchange) ? ExchangeNode.fromJSON(object.exchange) : undefined,
      columnOrders: Array.isArray(object?.columnOrders)
        ? object.columnOrders.map((e: any) => ColumnOrder.fromJSON(e))
        : [],
    };
  },

  toJSON(message: MergeSortExchangeNode): unknown {
    const obj: any = {};
    message.exchange !== undefined &&
      (obj.exchange = message.exchange ? ExchangeNode.toJSON(message.exchange) : undefined);
    if (message.columnOrders) {
      obj.columnOrders = message.columnOrders.map((e) => e ? ColumnOrder.toJSON(e) : undefined);
    } else {
      obj.columnOrders = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<MergeSortExchangeNode>, I>>(object: I): MergeSortExchangeNode {
    const message = createBaseMergeSortExchangeNode();
    message.exchange = (object.exchange !== undefined && object.exchange !== null)
      ? ExchangeNode.fromPartial(object.exchange)
      : undefined;
    message.columnOrders = object.columnOrders?.map((e) => ColumnOrder.fromPartial(e)) || [];
    return message;
  },
};

function createBaseLocalLookupJoinNode(): LocalLookupJoinNode {
  return {
    joinType: JoinType.UNSPECIFIED,
    condition: undefined,
    outerSideKey: [],
    innerSideKey: [],
    lookupPrefixLen: 0,
    innerSideTableDesc: undefined,
    innerSideVnodeMapping: [],
    innerSideColumnIds: [],
    outputIndices: [],
    workerNodes: [],
    nullSafe: [],
  };
}

export const LocalLookupJoinNode = {
  fromJSON(object: any): LocalLookupJoinNode {
    return {
      joinType: isSet(object.joinType) ? joinTypeFromJSON(object.joinType) : JoinType.UNSPECIFIED,
      condition: isSet(object.condition) ? ExprNode.fromJSON(object.condition) : undefined,
      outerSideKey: Array.isArray(object?.outerSideKey) ? object.outerSideKey.map((e: any) => Number(e)) : [],
      innerSideKey: Array.isArray(object?.innerSideKey) ? object.innerSideKey.map((e: any) => Number(e)) : [],
      lookupPrefixLen: isSet(object.lookupPrefixLen) ? Number(object.lookupPrefixLen) : 0,
      innerSideTableDesc: isSet(object.innerSideTableDesc)
        ? StorageTableDesc.fromJSON(object.innerSideTableDesc)
        : undefined,
      innerSideVnodeMapping: Array.isArray(object?.innerSideVnodeMapping)
        ? object.innerSideVnodeMapping.map((e: any) => Number(e))
        : [],
      innerSideColumnIds: Array.isArray(object?.innerSideColumnIds)
        ? object.innerSideColumnIds.map((e: any) => Number(e))
        : [],
      outputIndices: Array.isArray(object?.outputIndices)
        ? object.outputIndices.map((e: any) => Number(e))
        : [],
      workerNodes: Array.isArray(object?.workerNodes) ? object.workerNodes.map((e: any) => WorkerNode.fromJSON(e)) : [],
      nullSafe: Array.isArray(object?.nullSafe) ? object.nullSafe.map((e: any) => Boolean(e)) : [],
    };
  },

  toJSON(message: LocalLookupJoinNode): unknown {
    const obj: any = {};
    message.joinType !== undefined && (obj.joinType = joinTypeToJSON(message.joinType));
    message.condition !== undefined &&
      (obj.condition = message.condition ? ExprNode.toJSON(message.condition) : undefined);
    if (message.outerSideKey) {
      obj.outerSideKey = message.outerSideKey.map((e) => Math.round(e));
    } else {
      obj.outerSideKey = [];
    }
    if (message.innerSideKey) {
      obj.innerSideKey = message.innerSideKey.map((e) => Math.round(e));
    } else {
      obj.innerSideKey = [];
    }
    message.lookupPrefixLen !== undefined && (obj.lookupPrefixLen = Math.round(message.lookupPrefixLen));
    message.innerSideTableDesc !== undefined && (obj.innerSideTableDesc = message.innerSideTableDesc
      ? StorageTableDesc.toJSON(message.innerSideTableDesc)
      : undefined);
    if (message.innerSideVnodeMapping) {
      obj.innerSideVnodeMapping = message.innerSideVnodeMapping.map((e) => Math.round(e));
    } else {
      obj.innerSideVnodeMapping = [];
    }
    if (message.innerSideColumnIds) {
      obj.innerSideColumnIds = message.innerSideColumnIds.map((e) => Math.round(e));
    } else {
      obj.innerSideColumnIds = [];
    }
    if (message.outputIndices) {
      obj.outputIndices = message.outputIndices.map((e) => Math.round(e));
    } else {
      obj.outputIndices = [];
    }
    if (message.workerNodes) {
      obj.workerNodes = message.workerNodes.map((e) => e ? WorkerNode.toJSON(e) : undefined);
    } else {
      obj.workerNodes = [];
    }
    if (message.nullSafe) {
      obj.nullSafe = message.nullSafe.map((e) => e);
    } else {
      obj.nullSafe = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<LocalLookupJoinNode>, I>>(object: I): LocalLookupJoinNode {
    const message = createBaseLocalLookupJoinNode();
    message.joinType = object.joinType ?? JoinType.UNSPECIFIED;
    message.condition = (object.condition !== undefined && object.condition !== null)
      ? ExprNode.fromPartial(object.condition)
      : undefined;
    message.outerSideKey = object.outerSideKey?.map((e) => e) || [];
    message.innerSideKey = object.innerSideKey?.map((e) => e) || [];
    message.lookupPrefixLen = object.lookupPrefixLen ?? 0;
    message.innerSideTableDesc = (object.innerSideTableDesc !== undefined && object.innerSideTableDesc !== null)
      ? StorageTableDesc.fromPartial(object.innerSideTableDesc)
      : undefined;
    message.innerSideVnodeMapping = object.innerSideVnodeMapping?.map((e) => e) || [];
    message.innerSideColumnIds = object.innerSideColumnIds?.map((e) => e) || [];
    message.outputIndices = object.outputIndices?.map((e) => e) || [];
    message.workerNodes = object.workerNodes?.map((e) => WorkerNode.fromPartial(e)) || [];
    message.nullSafe = object.nullSafe?.map((e) => e) || [];
    return message;
  },
};

function createBaseDistributedLookupJoinNode(): DistributedLookupJoinNode {
  return {
    joinType: JoinType.UNSPECIFIED,
    condition: undefined,
    outerSideKey: [],
    innerSideKey: [],
    lookupPrefixLen: 0,
    innerSideTableDesc: undefined,
    innerSideColumnIds: [],
    outputIndices: [],
    nullSafe: [],
  };
}

export const DistributedLookupJoinNode = {
  fromJSON(object: any): DistributedLookupJoinNode {
    return {
      joinType: isSet(object.joinType) ? joinTypeFromJSON(object.joinType) : JoinType.UNSPECIFIED,
      condition: isSet(object.condition) ? ExprNode.fromJSON(object.condition) : undefined,
      outerSideKey: Array.isArray(object?.outerSideKey) ? object.outerSideKey.map((e: any) => Number(e)) : [],
      innerSideKey: Array.isArray(object?.innerSideKey) ? object.innerSideKey.map((e: any) => Number(e)) : [],
      lookupPrefixLen: isSet(object.lookupPrefixLen) ? Number(object.lookupPrefixLen) : 0,
      innerSideTableDesc: isSet(object.innerSideTableDesc)
        ? StorageTableDesc.fromJSON(object.innerSideTableDesc)
        : undefined,
      innerSideColumnIds: Array.isArray(object?.innerSideColumnIds)
        ? object.innerSideColumnIds.map((e: any) => Number(e))
        : [],
      outputIndices: Array.isArray(object?.outputIndices) ? object.outputIndices.map((e: any) => Number(e)) : [],
      nullSafe: Array.isArray(object?.nullSafe) ? object.nullSafe.map((e: any) => Boolean(e)) : [],
    };
  },

  toJSON(message: DistributedLookupJoinNode): unknown {
    const obj: any = {};
    message.joinType !== undefined && (obj.joinType = joinTypeToJSON(message.joinType));
    message.condition !== undefined &&
      (obj.condition = message.condition ? ExprNode.toJSON(message.condition) : undefined);
    if (message.outerSideKey) {
      obj.outerSideKey = message.outerSideKey.map((e) => Math.round(e));
    } else {
      obj.outerSideKey = [];
    }
    if (message.innerSideKey) {
      obj.innerSideKey = message.innerSideKey.map((e) => Math.round(e));
    } else {
      obj.innerSideKey = [];
    }
    message.lookupPrefixLen !== undefined && (obj.lookupPrefixLen = Math.round(message.lookupPrefixLen));
    message.innerSideTableDesc !== undefined && (obj.innerSideTableDesc = message.innerSideTableDesc
      ? StorageTableDesc.toJSON(message.innerSideTableDesc)
      : undefined);
    if (message.innerSideColumnIds) {
      obj.innerSideColumnIds = message.innerSideColumnIds.map((e) => Math.round(e));
    } else {
      obj.innerSideColumnIds = [];
    }
    if (message.outputIndices) {
      obj.outputIndices = message.outputIndices.map((e) => Math.round(e));
    } else {
      obj.outputIndices = [];
    }
    if (message.nullSafe) {
      obj.nullSafe = message.nullSafe.map((e) => e);
    } else {
      obj.nullSafe = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<DistributedLookupJoinNode>, I>>(object: I): DistributedLookupJoinNode {
    const message = createBaseDistributedLookupJoinNode();
    message.joinType = object.joinType ?? JoinType.UNSPECIFIED;
    message.condition = (object.condition !== undefined && object.condition !== null)
      ? ExprNode.fromPartial(object.condition)
      : undefined;
    message.outerSideKey = object.outerSideKey?.map((e) => e) || [];
    message.innerSideKey = object.innerSideKey?.map((e) => e) || [];
    message.lookupPrefixLen = object.lookupPrefixLen ?? 0;
    message.innerSideTableDesc = (object.innerSideTableDesc !== undefined && object.innerSideTableDesc !== null)
      ? StorageTableDesc.fromPartial(object.innerSideTableDesc)
      : undefined;
    message.innerSideColumnIds = object.innerSideColumnIds?.map((e) => e) || [];
    message.outputIndices = object.outputIndices?.map((e) => e) || [];
    message.nullSafe = object.nullSafe?.map((e) => e) || [];
    return message;
  },
};

function createBaseUnionNode(): UnionNode {
  return {};
}

export const UnionNode = {
  fromJSON(_: any): UnionNode {
    return {};
  },

  toJSON(_: UnionNode): unknown {
    const obj: any = {};
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<UnionNode>, I>>(_: I): UnionNode {
    const message = createBaseUnionNode();
    return message;
  },
};

function createBasePlanNode(): PlanNode {
  return { children: [], nodeBody: undefined, identity: "" };
}

export const PlanNode = {
  fromJSON(object: any): PlanNode {
    return {
      children: Array.isArray(object?.children) ? object.children.map((e: any) => PlanNode.fromJSON(e)) : [],
      nodeBody: isSet(object.insert)
        ? { $case: "insert", insert: InsertNode.fromJSON(object.insert) }
        : isSet(object.delete)
        ? { $case: "delete", delete: DeleteNode.fromJSON(object.delete) }
        : isSet(object.update)
        ? { $case: "update", update: UpdateNode.fromJSON(object.update) }
        : isSet(object.project)
        ? { $case: "project", project: ProjectNode.fromJSON(object.project) }
        : isSet(object.hashAgg)
        ? { $case: "hashAgg", hashAgg: HashAggNode.fromJSON(object.hashAgg) }
        : isSet(object.filter)
        ? { $case: "filter", filter: FilterNode.fromJSON(object.filter) }
        : isSet(object.exchange)
        ? { $case: "exchange", exchange: ExchangeNode.fromJSON(object.exchange) }
        : isSet(object.sort)
        ? { $case: "sort", sort: SortNode.fromJSON(object.sort) }
        : isSet(object.nestedLoopJoin)
        ? { $case: "nestedLoopJoin", nestedLoopJoin: NestedLoopJoinNode.fromJSON(object.nestedLoopJoin) }
        : isSet(object.topN)
        ? { $case: "topN", topN: TopNNode.fromJSON(object.topN) }
        : isSet(object.sortAgg)
        ? { $case: "sortAgg", sortAgg: SortAggNode.fromJSON(object.sortAgg) }
        : isSet(object.rowSeqScan)
        ? { $case: "rowSeqScan", rowSeqScan: RowSeqScanNode.fromJSON(object.rowSeqScan) }
        : isSet(object.limit)
        ? { $case: "limit", limit: LimitNode.fromJSON(object.limit) }
        : isSet(object.values)
        ? { $case: "values", values: ValuesNode.fromJSON(object.values) }
        : isSet(object.hashJoin)
        ? { $case: "hashJoin", hashJoin: HashJoinNode.fromJSON(object.hashJoin) }
        : isSet(object.mergeSortExchange)
        ? { $case: "mergeSortExchange", mergeSortExchange: MergeSortExchangeNode.fromJSON(object.mergeSortExchange) }
        : isSet(object.hopWindow)
        ? { $case: "hopWindow", hopWindow: HopWindowNode.fromJSON(object.hopWindow) }
        : isSet(object.tableFunction)
        ? { $case: "tableFunction", tableFunction: TableFunctionNode.fromJSON(object.tableFunction) }
        : isSet(object.sysRowSeqScan)
        ? { $case: "sysRowSeqScan", sysRowSeqScan: SysRowSeqScanNode.fromJSON(object.sysRowSeqScan) }
        : isSet(object.expand)
        ? { $case: "expand", expand: ExpandNode.fromJSON(object.expand) }
        : isSet(object.localLookupJoin)
        ? { $case: "localLookupJoin", localLookupJoin: LocalLookupJoinNode.fromJSON(object.localLookupJoin) }
        : isSet(object.projectSet)
        ? { $case: "projectSet", projectSet: ProjectSetNode.fromJSON(object.projectSet) }
        : isSet(object.union)
        ? { $case: "union", union: UnionNode.fromJSON(object.union) }
        : isSet(object.groupTopN)
        ? { $case: "groupTopN", groupTopN: GroupTopNNode.fromJSON(object.groupTopN) }
        : isSet(object.distributedLookupJoin)
        ? {
          $case: "distributedLookupJoin",
          distributedLookupJoin: DistributedLookupJoinNode.fromJSON(object.distributedLookupJoin),
        }
        : isSet(object.source)
        ? { $case: "source", source: SourceNode.fromJSON(object.source) }
        : undefined,
      identity: isSet(object.identity) ? String(object.identity) : "",
    };
  },

  toJSON(message: PlanNode): unknown {
    const obj: any = {};
    if (message.children) {
      obj.children = message.children.map((e) => e ? PlanNode.toJSON(e) : undefined);
    } else {
      obj.children = [];
    }
    message.nodeBody?.$case === "insert" &&
      (obj.insert = message.nodeBody?.insert ? InsertNode.toJSON(message.nodeBody?.insert) : undefined);
    message.nodeBody?.$case === "delete" &&
      (obj.delete = message.nodeBody?.delete ? DeleteNode.toJSON(message.nodeBody?.delete) : undefined);
    message.nodeBody?.$case === "update" &&
      (obj.update = message.nodeBody?.update ? UpdateNode.toJSON(message.nodeBody?.update) : undefined);
    message.nodeBody?.$case === "project" &&
      (obj.project = message.nodeBody?.project ? ProjectNode.toJSON(message.nodeBody?.project) : undefined);
    message.nodeBody?.$case === "hashAgg" &&
      (obj.hashAgg = message.nodeBody?.hashAgg ? HashAggNode.toJSON(message.nodeBody?.hashAgg) : undefined);
    message.nodeBody?.$case === "filter" &&
      (obj.filter = message.nodeBody?.filter ? FilterNode.toJSON(message.nodeBody?.filter) : undefined);
    message.nodeBody?.$case === "exchange" &&
      (obj.exchange = message.nodeBody?.exchange ? ExchangeNode.toJSON(message.nodeBody?.exchange) : undefined);
    message.nodeBody?.$case === "sort" &&
      (obj.sort = message.nodeBody?.sort ? SortNode.toJSON(message.nodeBody?.sort) : undefined);
    message.nodeBody?.$case === "nestedLoopJoin" && (obj.nestedLoopJoin = message.nodeBody?.nestedLoopJoin
      ? NestedLoopJoinNode.toJSON(message.nodeBody?.nestedLoopJoin)
      : undefined);
    message.nodeBody?.$case === "topN" &&
      (obj.topN = message.nodeBody?.topN ? TopNNode.toJSON(message.nodeBody?.topN) : undefined);
    message.nodeBody?.$case === "sortAgg" &&
      (obj.sortAgg = message.nodeBody?.sortAgg ? SortAggNode.toJSON(message.nodeBody?.sortAgg) : undefined);
    message.nodeBody?.$case === "rowSeqScan" &&
      (obj.rowSeqScan = message.nodeBody?.rowSeqScan ? RowSeqScanNode.toJSON(message.nodeBody?.rowSeqScan) : undefined);
    message.nodeBody?.$case === "limit" &&
      (obj.limit = message.nodeBody?.limit ? LimitNode.toJSON(message.nodeBody?.limit) : undefined);
    message.nodeBody?.$case === "values" &&
      (obj.values = message.nodeBody?.values ? ValuesNode.toJSON(message.nodeBody?.values) : undefined);
    message.nodeBody?.$case === "hashJoin" &&
      (obj.hashJoin = message.nodeBody?.hashJoin ? HashJoinNode.toJSON(message.nodeBody?.hashJoin) : undefined);
    message.nodeBody?.$case === "mergeSortExchange" && (obj.mergeSortExchange = message.nodeBody?.mergeSortExchange
      ? MergeSortExchangeNode.toJSON(message.nodeBody?.mergeSortExchange)
      : undefined);
    message.nodeBody?.$case === "hopWindow" &&
      (obj.hopWindow = message.nodeBody?.hopWindow ? HopWindowNode.toJSON(message.nodeBody?.hopWindow) : undefined);
    message.nodeBody?.$case === "tableFunction" && (obj.tableFunction = message.nodeBody?.tableFunction
      ? TableFunctionNode.toJSON(message.nodeBody?.tableFunction)
      : undefined);
    message.nodeBody?.$case === "sysRowSeqScan" && (obj.sysRowSeqScan = message.nodeBody?.sysRowSeqScan
      ? SysRowSeqScanNode.toJSON(message.nodeBody?.sysRowSeqScan)
      : undefined);
    message.nodeBody?.$case === "expand" &&
      (obj.expand = message.nodeBody?.expand ? ExpandNode.toJSON(message.nodeBody?.expand) : undefined);
    message.nodeBody?.$case === "localLookupJoin" && (obj.localLookupJoin = message.nodeBody?.localLookupJoin
      ? LocalLookupJoinNode.toJSON(message.nodeBody?.localLookupJoin)
      : undefined);
    message.nodeBody?.$case === "projectSet" &&
      (obj.projectSet = message.nodeBody?.projectSet ? ProjectSetNode.toJSON(message.nodeBody?.projectSet) : undefined);
    message.nodeBody?.$case === "union" &&
      (obj.union = message.nodeBody?.union ? UnionNode.toJSON(message.nodeBody?.union) : undefined);
    message.nodeBody?.$case === "groupTopN" &&
      (obj.groupTopN = message.nodeBody?.groupTopN ? GroupTopNNode.toJSON(message.nodeBody?.groupTopN) : undefined);
    message.nodeBody?.$case === "distributedLookupJoin" &&
      (obj.distributedLookupJoin = message.nodeBody?.distributedLookupJoin
        ? DistributedLookupJoinNode.toJSON(message.nodeBody?.distributedLookupJoin)
        : undefined);
    message.nodeBody?.$case === "source" &&
      (obj.source = message.nodeBody?.source ? SourceNode.toJSON(message.nodeBody?.source) : undefined);
    message.identity !== undefined && (obj.identity = message.identity);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<PlanNode>, I>>(object: I): PlanNode {
    const message = createBasePlanNode();
    message.children = object.children?.map((e) => PlanNode.fromPartial(e)) || [];
    if (
      object.nodeBody?.$case === "insert" && object.nodeBody?.insert !== undefined && object.nodeBody?.insert !== null
    ) {
      message.nodeBody = { $case: "insert", insert: InsertNode.fromPartial(object.nodeBody.insert) };
    }
    if (
      object.nodeBody?.$case === "delete" && object.nodeBody?.delete !== undefined && object.nodeBody?.delete !== null
    ) {
      message.nodeBody = { $case: "delete", delete: DeleteNode.fromPartial(object.nodeBody.delete) };
    }
    if (
      object.nodeBody?.$case === "update" && object.nodeBody?.update !== undefined && object.nodeBody?.update !== null
    ) {
      message.nodeBody = { $case: "update", update: UpdateNode.fromPartial(object.nodeBody.update) };
    }
    if (
      object.nodeBody?.$case === "project" &&
      object.nodeBody?.project !== undefined &&
      object.nodeBody?.project !== null
    ) {
      message.nodeBody = { $case: "project", project: ProjectNode.fromPartial(object.nodeBody.project) };
    }
    if (
      object.nodeBody?.$case === "hashAgg" &&
      object.nodeBody?.hashAgg !== undefined &&
      object.nodeBody?.hashAgg !== null
    ) {
      message.nodeBody = { $case: "hashAgg", hashAgg: HashAggNode.fromPartial(object.nodeBody.hashAgg) };
    }
    if (
      object.nodeBody?.$case === "filter" && object.nodeBody?.filter !== undefined && object.nodeBody?.filter !== null
    ) {
      message.nodeBody = { $case: "filter", filter: FilterNode.fromPartial(object.nodeBody.filter) };
    }
    if (
      object.nodeBody?.$case === "exchange" &&
      object.nodeBody?.exchange !== undefined &&
      object.nodeBody?.exchange !== null
    ) {
      message.nodeBody = { $case: "exchange", exchange: ExchangeNode.fromPartial(object.nodeBody.exchange) };
    }
    if (object.nodeBody?.$case === "sort" && object.nodeBody?.sort !== undefined && object.nodeBody?.sort !== null) {
      message.nodeBody = { $case: "sort", sort: SortNode.fromPartial(object.nodeBody.sort) };
    }
    if (
      object.nodeBody?.$case === "nestedLoopJoin" &&
      object.nodeBody?.nestedLoopJoin !== undefined &&
      object.nodeBody?.nestedLoopJoin !== null
    ) {
      message.nodeBody = {
        $case: "nestedLoopJoin",
        nestedLoopJoin: NestedLoopJoinNode.fromPartial(object.nodeBody.nestedLoopJoin),
      };
    }
    if (object.nodeBody?.$case === "topN" && object.nodeBody?.topN !== undefined && object.nodeBody?.topN !== null) {
      message.nodeBody = { $case: "topN", topN: TopNNode.fromPartial(object.nodeBody.topN) };
    }
    if (
      object.nodeBody?.$case === "sortAgg" &&
      object.nodeBody?.sortAgg !== undefined &&
      object.nodeBody?.sortAgg !== null
    ) {
      message.nodeBody = { $case: "sortAgg", sortAgg: SortAggNode.fromPartial(object.nodeBody.sortAgg) };
    }
    if (
      object.nodeBody?.$case === "rowSeqScan" &&
      object.nodeBody?.rowSeqScan !== undefined &&
      object.nodeBody?.rowSeqScan !== null
    ) {
      message.nodeBody = { $case: "rowSeqScan", rowSeqScan: RowSeqScanNode.fromPartial(object.nodeBody.rowSeqScan) };
    }
    if (object.nodeBody?.$case === "limit" && object.nodeBody?.limit !== undefined && object.nodeBody?.limit !== null) {
      message.nodeBody = { $case: "limit", limit: LimitNode.fromPartial(object.nodeBody.limit) };
    }
    if (
      object.nodeBody?.$case === "values" && object.nodeBody?.values !== undefined && object.nodeBody?.values !== null
    ) {
      message.nodeBody = { $case: "values", values: ValuesNode.fromPartial(object.nodeBody.values) };
    }
    if (
      object.nodeBody?.$case === "hashJoin" &&
      object.nodeBody?.hashJoin !== undefined &&
      object.nodeBody?.hashJoin !== null
    ) {
      message.nodeBody = { $case: "hashJoin", hashJoin: HashJoinNode.fromPartial(object.nodeBody.hashJoin) };
    }
    if (
      object.nodeBody?.$case === "mergeSortExchange" &&
      object.nodeBody?.mergeSortExchange !== undefined &&
      object.nodeBody?.mergeSortExchange !== null
    ) {
      message.nodeBody = {
        $case: "mergeSortExchange",
        mergeSortExchange: MergeSortExchangeNode.fromPartial(object.nodeBody.mergeSortExchange),
      };
    }
    if (
      object.nodeBody?.$case === "hopWindow" &&
      object.nodeBody?.hopWindow !== undefined &&
      object.nodeBody?.hopWindow !== null
    ) {
      message.nodeBody = { $case: "hopWindow", hopWindow: HopWindowNode.fromPartial(object.nodeBody.hopWindow) };
    }
    if (
      object.nodeBody?.$case === "tableFunction" &&
      object.nodeBody?.tableFunction !== undefined &&
      object.nodeBody?.tableFunction !== null
    ) {
      message.nodeBody = {
        $case: "tableFunction",
        tableFunction: TableFunctionNode.fromPartial(object.nodeBody.tableFunction),
      };
    }
    if (
      object.nodeBody?.$case === "sysRowSeqScan" &&
      object.nodeBody?.sysRowSeqScan !== undefined &&
      object.nodeBody?.sysRowSeqScan !== null
    ) {
      message.nodeBody = {
        $case: "sysRowSeqScan",
        sysRowSeqScan: SysRowSeqScanNode.fromPartial(object.nodeBody.sysRowSeqScan),
      };
    }
    if (
      object.nodeBody?.$case === "expand" && object.nodeBody?.expand !== undefined && object.nodeBody?.expand !== null
    ) {
      message.nodeBody = { $case: "expand", expand: ExpandNode.fromPartial(object.nodeBody.expand) };
    }
    if (
      object.nodeBody?.$case === "localLookupJoin" &&
      object.nodeBody?.localLookupJoin !== undefined &&
      object.nodeBody?.localLookupJoin !== null
    ) {
      message.nodeBody = {
        $case: "localLookupJoin",
        localLookupJoin: LocalLookupJoinNode.fromPartial(object.nodeBody.localLookupJoin),
      };
    }
    if (
      object.nodeBody?.$case === "projectSet" &&
      object.nodeBody?.projectSet !== undefined &&
      object.nodeBody?.projectSet !== null
    ) {
      message.nodeBody = { $case: "projectSet", projectSet: ProjectSetNode.fromPartial(object.nodeBody.projectSet) };
    }
    if (object.nodeBody?.$case === "union" && object.nodeBody?.union !== undefined && object.nodeBody?.union !== null) {
      message.nodeBody = { $case: "union", union: UnionNode.fromPartial(object.nodeBody.union) };
    }
    if (
      object.nodeBody?.$case === "groupTopN" &&
      object.nodeBody?.groupTopN !== undefined &&
      object.nodeBody?.groupTopN !== null
    ) {
      message.nodeBody = { $case: "groupTopN", groupTopN: GroupTopNNode.fromPartial(object.nodeBody.groupTopN) };
    }
    if (
      object.nodeBody?.$case === "distributedLookupJoin" &&
      object.nodeBody?.distributedLookupJoin !== undefined &&
      object.nodeBody?.distributedLookupJoin !== null
    ) {
      message.nodeBody = {
        $case: "distributedLookupJoin",
        distributedLookupJoin: DistributedLookupJoinNode.fromPartial(object.nodeBody.distributedLookupJoin),
      };
    }
    if (
      object.nodeBody?.$case === "source" && object.nodeBody?.source !== undefined && object.nodeBody?.source !== null
    ) {
      message.nodeBody = { $case: "source", source: SourceNode.fromPartial(object.nodeBody.source) };
    }
    message.identity = object.identity ?? "";
    return message;
  },
};

function createBaseExchangeInfo(): ExchangeInfo {
  return { mode: ExchangeInfo_DistributionMode.UNSPECIFIED, distribution: undefined };
}

export const ExchangeInfo = {
  fromJSON(object: any): ExchangeInfo {
    return {
      mode: isSet(object.mode)
        ? exchangeInfo_DistributionModeFromJSON(object.mode)
        : ExchangeInfo_DistributionMode.UNSPECIFIED,
      distribution: isSet(object.broadcastInfo)
        ? { $case: "broadcastInfo", broadcastInfo: ExchangeInfo_BroadcastInfo.fromJSON(object.broadcastInfo) }
        : isSet(object.hashInfo)
        ? { $case: "hashInfo", hashInfo: ExchangeInfo_HashInfo.fromJSON(object.hashInfo) }
        : isSet(object.consistentHashInfo)
        ? {
          $case: "consistentHashInfo",
          consistentHashInfo: ExchangeInfo_ConsistentHashInfo.fromJSON(object.consistentHashInfo),
        }
        : undefined,
    };
  },

  toJSON(message: ExchangeInfo): unknown {
    const obj: any = {};
    message.mode !== undefined && (obj.mode = exchangeInfo_DistributionModeToJSON(message.mode));
    message.distribution?.$case === "broadcastInfo" && (obj.broadcastInfo = message.distribution?.broadcastInfo
      ? ExchangeInfo_BroadcastInfo.toJSON(message.distribution?.broadcastInfo)
      : undefined);
    message.distribution?.$case === "hashInfo" && (obj.hashInfo = message.distribution?.hashInfo
      ? ExchangeInfo_HashInfo.toJSON(message.distribution?.hashInfo)
      : undefined);
    message.distribution?.$case === "consistentHashInfo" &&
      (obj.consistentHashInfo = message.distribution?.consistentHashInfo
        ? ExchangeInfo_ConsistentHashInfo.toJSON(message.distribution?.consistentHashInfo)
        : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ExchangeInfo>, I>>(object: I): ExchangeInfo {
    const message = createBaseExchangeInfo();
    message.mode = object.mode ?? ExchangeInfo_DistributionMode.UNSPECIFIED;
    if (
      object.distribution?.$case === "broadcastInfo" &&
      object.distribution?.broadcastInfo !== undefined &&
      object.distribution?.broadcastInfo !== null
    ) {
      message.distribution = {
        $case: "broadcastInfo",
        broadcastInfo: ExchangeInfo_BroadcastInfo.fromPartial(object.distribution.broadcastInfo),
      };
    }
    if (
      object.distribution?.$case === "hashInfo" &&
      object.distribution?.hashInfo !== undefined &&
      object.distribution?.hashInfo !== null
    ) {
      message.distribution = {
        $case: "hashInfo",
        hashInfo: ExchangeInfo_HashInfo.fromPartial(object.distribution.hashInfo),
      };
    }
    if (
      object.distribution?.$case === "consistentHashInfo" &&
      object.distribution?.consistentHashInfo !== undefined &&
      object.distribution?.consistentHashInfo !== null
    ) {
      message.distribution = {
        $case: "consistentHashInfo",
        consistentHashInfo: ExchangeInfo_ConsistentHashInfo.fromPartial(object.distribution.consistentHashInfo),
      };
    }
    return message;
  },
};

function createBaseExchangeInfo_BroadcastInfo(): ExchangeInfo_BroadcastInfo {
  return { count: 0 };
}

export const ExchangeInfo_BroadcastInfo = {
  fromJSON(object: any): ExchangeInfo_BroadcastInfo {
    return { count: isSet(object.count) ? Number(object.count) : 0 };
  },

  toJSON(message: ExchangeInfo_BroadcastInfo): unknown {
    const obj: any = {};
    message.count !== undefined && (obj.count = Math.round(message.count));
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ExchangeInfo_BroadcastInfo>, I>>(object: I): ExchangeInfo_BroadcastInfo {
    const message = createBaseExchangeInfo_BroadcastInfo();
    message.count = object.count ?? 0;
    return message;
  },
};

function createBaseExchangeInfo_HashInfo(): ExchangeInfo_HashInfo {
  return { outputCount: 0, key: [] };
}

export const ExchangeInfo_HashInfo = {
  fromJSON(object: any): ExchangeInfo_HashInfo {
    return {
      outputCount: isSet(object.outputCount) ? Number(object.outputCount) : 0,
      key: Array.isArray(object?.key) ? object.key.map((e: any) => Number(e)) : [],
    };
  },

  toJSON(message: ExchangeInfo_HashInfo): unknown {
    const obj: any = {};
    message.outputCount !== undefined && (obj.outputCount = Math.round(message.outputCount));
    if (message.key) {
      obj.key = message.key.map((e) => Math.round(e));
    } else {
      obj.key = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ExchangeInfo_HashInfo>, I>>(object: I): ExchangeInfo_HashInfo {
    const message = createBaseExchangeInfo_HashInfo();
    message.outputCount = object.outputCount ?? 0;
    message.key = object.key?.map((e) => e) || [];
    return message;
  },
};

function createBaseExchangeInfo_ConsistentHashInfo(): ExchangeInfo_ConsistentHashInfo {
  return { vmap: [], key: [] };
}

export const ExchangeInfo_ConsistentHashInfo = {
  fromJSON(object: any): ExchangeInfo_ConsistentHashInfo {
    return {
      vmap: Array.isArray(object?.vmap) ? object.vmap.map((e: any) => Number(e)) : [],
      key: Array.isArray(object?.key) ? object.key.map((e: any) => Number(e)) : [],
    };
  },

  toJSON(message: ExchangeInfo_ConsistentHashInfo): unknown {
    const obj: any = {};
    if (message.vmap) {
      obj.vmap = message.vmap.map((e) => Math.round(e));
    } else {
      obj.vmap = [];
    }
    if (message.key) {
      obj.key = message.key.map((e) => Math.round(e));
    } else {
      obj.key = [];
    }
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<ExchangeInfo_ConsistentHashInfo>, I>>(
    object: I,
  ): ExchangeInfo_ConsistentHashInfo {
    const message = createBaseExchangeInfo_ConsistentHashInfo();
    message.vmap = object.vmap?.map((e) => e) || [];
    message.key = object.key?.map((e) => e) || [];
    return message;
  },
};

function createBasePlanFragment(): PlanFragment {
  return { root: undefined, exchangeInfo: undefined };
}

export const PlanFragment = {
  fromJSON(object: any): PlanFragment {
    return {
      root: isSet(object.root) ? PlanNode.fromJSON(object.root) : undefined,
      exchangeInfo: isSet(object.exchangeInfo) ? ExchangeInfo.fromJSON(object.exchangeInfo) : undefined,
    };
  },

  toJSON(message: PlanFragment): unknown {
    const obj: any = {};
    message.root !== undefined && (obj.root = message.root ? PlanNode.toJSON(message.root) : undefined);
    message.exchangeInfo !== undefined &&
      (obj.exchangeInfo = message.exchangeInfo ? ExchangeInfo.toJSON(message.exchangeInfo) : undefined);
    return obj;
  },

  fromPartial<I extends Exact<DeepPartial<PlanFragment>, I>>(object: I): PlanFragment {
    const message = createBasePlanFragment();
    message.root = (object.root !== undefined && object.root !== null) ? PlanNode.fromPartial(object.root) : undefined;
    message.exchangeInfo = (object.exchangeInfo !== undefined && object.exchangeInfo !== null)
      ? ExchangeInfo.fromPartial(object.exchangeInfo)
      : undefined;
    return message;
  },
};

declare var self: any | undefined;
declare var window: any | undefined;
declare var global: any | undefined;
var globalThis: any = (() => {
  if (typeof globalThis !== "undefined") {
    return globalThis;
  }
  if (typeof self !== "undefined") {
    return self;
  }
  if (typeof window !== "undefined") {
    return window;
  }
  if (typeof global !== "undefined") {
    return global;
  }
  throw "Unable to locate global object";
})();

function bytesFromBase64(b64: string): Uint8Array {
  if (globalThis.Buffer) {
    return Uint8Array.from(globalThis.Buffer.from(b64, "base64"));
  } else {
    const bin = globalThis.atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; ++i) {
      arr[i] = bin.charCodeAt(i);
    }
    return arr;
  }
}

function base64FromBytes(arr: Uint8Array): string {
  if (globalThis.Buffer) {
    return globalThis.Buffer.from(arr).toString("base64");
  } else {
    const bin: string[] = [];
    arr.forEach((byte) => {
      bin.push(String.fromCharCode(byte));
    });
    return globalThis.btoa(bin.join(""));
  }
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined;

export type DeepPartial<T> = T extends Builtin ? T
  : T extends Array<infer U> ? Array<DeepPartial<U>> : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends { $case: string } ? { [K in keyof Omit<T, "$case">]?: DeepPartial<T[K]> } & { $case: T["$case"] }
  : T extends {} ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;

type KeysOfUnion<T> = T extends T ? keyof T : never;
export type Exact<P, I extends P> = P extends Builtin ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & { [K in Exclude<keyof I, KeysOfUnion<P>>]: never };

function isObject(value: any): boolean {
  return typeof value === "object" && value !== null;
}

function isSet(value: any): boolean {
  return value !== null && value !== undefined;
}
