// Copyright 2023 RisingWave Labs
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use std::collections::{HashMap, HashSet};
use std::num::NonZeroUsize;
use std::vec;

use itertools::Itertools;
use risingwave_common::catalog::{DatabaseId, SchemaId, TableId};
use risingwave_pb::catalog::Table as ProstTable;
use risingwave_pb::common::{ParallelUnit, WorkerNode};
use risingwave_pb::data::data_type::TypeName;
use risingwave_pb::data::DataType;
use risingwave_pb::expr::agg_call::{Arg, Type};
use risingwave_pb::expr::expr_node::RexNode;
use risingwave_pb::expr::expr_node::Type::{Add, GreaterThan, InputRef};
use risingwave_pb::expr::{AggCall, ExprNode, FunctionCall, InputRefExpr};
use risingwave_pb::plan_common::{ColumnCatalog, ColumnDesc, ColumnOrder, Field, OrderType};
use risingwave_pb::stream_plan::stream_fragment_graph::{StreamFragment, StreamFragmentEdge};
use risingwave_pb::stream_plan::stream_node::NodeBody;
use risingwave_pb::stream_plan::{
    agg_call_state, AggCallState, DispatchStrategy, DispatcherType, ExchangeNode, FilterNode,
    FragmentTypeFlag, MaterializeNode, ProjectNode, SimpleAggNode, SourceNode, StreamEnvironment,
    StreamFragmentGraph as StreamFragmentGraphProto, StreamNode, StreamSource,
};

use crate::manager::{MetaSrvEnv, StreamingClusterInfo, StreamingJob};
use crate::model::TableFragments;
use crate::stream::{
    ActorGraphBuildResult, ActorGraphBuilder, CompleteStreamFragmentGraph, StreamFragmentGraph,
};
use crate::MetaResult;

fn make_inputref(idx: i32) -> ExprNode {
    ExprNode {
        expr_type: InputRef as i32,
        return_type: Some(DataType {
            type_name: TypeName::Int32 as i32,
            ..Default::default()
        }),
        rex_node: Some(RexNode::InputRef(InputRefExpr { column_idx: idx })),
    }
}

fn make_sum_aggcall(idx: i32) -> AggCall {
    AggCall {
        r#type: Type::Sum as i32,
        args: vec![Arg {
            input: Some(InputRefExpr { column_idx: idx }),
            r#type: Some(DataType {
                type_name: TypeName::Int64 as i32,
                ..Default::default()
            }),
        }],
        return_type: Some(DataType {
            type_name: TypeName::Int64 as i32,
            ..Default::default()
        }),
        distinct: false,
        order_by_fields: vec![],
        filter: None,
    }
}

fn make_agg_call_result_state() -> AggCallState {
    AggCallState {
        inner: Some(agg_call_state::Inner::ResultValueState(
            agg_call_state::ResultValueState {},
        )),
    }
}

fn make_field(type_name: TypeName) -> Field {
    Field {
        data_type: Some(DataType {
            type_name: type_name as i32,
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn make_column_order(index: u32) -> ColumnOrder {
    ColumnOrder {
        order_type: OrderType::Ascending as i32,
        index,
    }
}

fn make_column(column_type: TypeName, column_id: i32) -> ColumnCatalog {
    ColumnCatalog {
        column_desc: Some(ColumnDesc {
            column_type: Some(DataType {
                type_name: column_type as i32,
                ..Default::default()
            }),
            column_id,
            ..Default::default()
        }),
        is_hidden: false,
    }
}

fn make_source_internal_table(id: u32) -> ProstTable {
    let columns = vec![
        make_column(TypeName::Varchar, 0),
        make_column(TypeName::Varchar, 1),
    ];
    ProstTable {
        id,
        schema_id: SchemaId::placeholder().schema_id,
        database_id: DatabaseId::placeholder().database_id,
        name: String::new(),
        columns,
        pk: vec![ColumnOrder {
            index: 0,
            order_type: 2,
        }],
        ..Default::default()
    }
}

fn make_internal_table(id: u32, is_agg_value: bool) -> ProstTable {
    let mut columns = vec![make_column(TypeName::Int64, 0)];
    if !is_agg_value {
        columns.push(make_column(TypeName::Int32, 1));
    }
    ProstTable {
        id,
        schema_id: SchemaId::placeholder().schema_id,
        database_id: DatabaseId::placeholder().database_id,
        name: String::new(),
        columns,
        pk: vec![ColumnOrder {
            index: 0,
            order_type: 2,
        }],
        stream_key: vec![2],
        ..Default::default()
    }
}

fn make_empty_table(id: u32) -> ProstTable {
    ProstTable {
        id,
        schema_id: SchemaId::placeholder().schema_id,
        database_id: DatabaseId::placeholder().database_id,
        name: String::new(),
        columns: vec![],
        pk: vec![],
        stream_key: vec![],
        ..Default::default()
    }
}

fn make_materialize_table(id: u32) -> ProstTable {
    make_internal_table(id, true)
}

/// [`make_stream_fragments`] build all stream fragments for SQL as follow:
/// ```sql
/// create table t (v1 int, v2 int);
/// create materialized view T_distributed as select sum(v1)+1 as V from t where v1>v2;
/// ```
fn make_stream_fragments() -> Vec<StreamFragment> {
    let mut fragments = vec![];
    // table source node
    let column_ids = vec![1, 2, 0];
    let columns = column_ids
        .iter()
        .map(|column_id| ColumnCatalog {
            column_desc: Some(ColumnDesc {
                column_id: *column_id,
                ..Default::default()
            }),
            ..Default::default()
        })
        .collect_vec();
    let source_node = StreamNode {
        node_body: Some(NodeBody::Source(SourceNode {
            source_inner: Some(StreamSource {
                source_id: 1,
                state_table: Some(make_source_internal_table(0)),
                columns,
                ..Default::default()
            }),
        })),
        stream_key: vec![2],
        ..Default::default()
    };
    fragments.push(StreamFragment {
        fragment_id: 2,
        node: Some(source_node),
        fragment_type_mask: FragmentTypeFlag::Source as u32,
        is_singleton: false,
        table_ids_cnt: 0,
        upstream_table_ids: vec![],
    });

    // exchange node
    let exchange_node = StreamNode {
        node_body: Some(NodeBody::Exchange(ExchangeNode {
            strategy: Some(DispatchStrategy {
                r#type: DispatcherType::Hash as i32,
                column_indices: vec![0],
            }),
        })),
        fields: vec![
            make_field(TypeName::Int32),
            make_field(TypeName::Int32),
            make_field(TypeName::Int64),
        ],
        input: vec![],
        stream_key: vec![2],
        operator_id: 1,
        identity: "ExchangeExecutor".to_string(),
        ..Default::default()
    };

    // filter node
    let function_call = FunctionCall {
        children: vec![make_inputref(0), make_inputref(1)],
    };
    let filter_node = StreamNode {
        node_body: Some(NodeBody::Filter(FilterNode {
            search_condition: Some(ExprNode {
                expr_type: GreaterThan as i32,
                return_type: Some(DataType {
                    type_name: TypeName::Boolean as i32,
                    ..Default::default()
                }),
                rex_node: Some(RexNode::FuncCall(function_call)),
            }),
        })),
        fields: vec![], // TODO: fill this later
        input: vec![exchange_node],
        stream_key: vec![0, 1],
        operator_id: 2,
        identity: "FilterExecutor".to_string(),
        ..Default::default()
    };

    // simple agg node
    let simple_agg_node = StreamNode {
        node_body: Some(NodeBody::GlobalSimpleAgg(SimpleAggNode {
            agg_calls: vec![make_sum_aggcall(0), make_sum_aggcall(1)],
            distribution_key: Default::default(),
            is_append_only: false,
            agg_call_states: vec![make_agg_call_result_state(), make_agg_call_result_state()],
            result_table: Some(make_empty_table(1)),
        })),
        input: vec![filter_node],
        fields: vec![], // TODO: fill this later
        stream_key: vec![0, 1],
        operator_id: 3,
        identity: "GlobalSimpleAggExecutor".to_string(),
        ..Default::default()
    };

    fragments.push(StreamFragment {
        fragment_id: 1,
        node: Some(simple_agg_node),
        fragment_type_mask: FragmentTypeFlag::FragmentUnspecified as u32,
        is_singleton: false,
        table_ids_cnt: 0,
        upstream_table_ids: vec![],
    });

    // exchange node
    let exchange_node_1 = StreamNode {
        node_body: Some(NodeBody::Exchange(ExchangeNode {
            strategy: Some(DispatchStrategy {
                r#type: DispatcherType::Simple as i32,
                ..Default::default()
            }),
        })),
        fields: vec![make_field(TypeName::Int64), make_field(TypeName::Int64)],
        input: vec![],
        stream_key: vec![0, 1],
        operator_id: 4,
        identity: "ExchangeExecutor".to_string(),
        ..Default::default()
    };

    // agg node
    let simple_agg_node_1 = StreamNode {
        node_body: Some(NodeBody::GlobalSimpleAgg(SimpleAggNode {
            agg_calls: vec![make_sum_aggcall(0), make_sum_aggcall(1)],
            distribution_key: Default::default(),
            is_append_only: false,
            agg_call_states: vec![make_agg_call_result_state(), make_agg_call_result_state()],
            result_table: Some(make_empty_table(2)),
        })),
        fields: vec![], // TODO: fill this later
        input: vec![exchange_node_1],
        stream_key: vec![0, 1],
        operator_id: 5,
        identity: "GlobalSimpleAggExecutor".to_string(),
        ..Default::default()
    };

    // project node
    let function_call_1 = FunctionCall {
        children: vec![make_inputref(0), make_inputref(1)],
    };
    let project_node = StreamNode {
        node_body: Some(NodeBody::Project(ProjectNode {
            select_list: vec![
                ExprNode {
                    rex_node: Some(RexNode::FuncCall(function_call_1)),
                    expr_type: Add as i32,
                    return_type: Some(DataType {
                        type_name: TypeName::Int64 as i32,
                        ..Default::default()
                    }),
                },
                make_inputref(0),
                make_inputref(1),
            ],
            watermark_input_key: vec![],
            watermark_output_key: vec![],
        })),
        fields: vec![], // TODO: fill this later
        input: vec![simple_agg_node_1],
        stream_key: vec![1, 2],
        operator_id: 6,
        identity: "ProjectExecutor".to_string(),
        ..Default::default()
    };

    // mview node
    let mview_node = StreamNode {
        input: vec![project_node],
        stream_key: vec![],
        node_body: Some(NodeBody::Materialize(MaterializeNode {
            table_id: 1,
            table: Some(make_materialize_table(888)),
            column_orders: vec![make_column_order(1), make_column_order(2)],
            handle_pk_conflict: false,
        })),
        fields: vec![], // TODO: fill this later
        operator_id: 7,
        identity: "MaterializeExecutor".to_string(),
        ..Default::default()
    };

    fragments.push(StreamFragment {
        fragment_id: 0,
        node: Some(mview_node),
        fragment_type_mask: FragmentTypeFlag::Mview as u32,
        is_singleton: true,
        table_ids_cnt: 0,
        upstream_table_ids: vec![],
    });

    fragments
}

fn make_fragment_edges() -> Vec<StreamFragmentEdge> {
    vec![
        StreamFragmentEdge {
            dispatch_strategy: Some(DispatchStrategy {
                r#type: DispatcherType::Simple as i32,
                column_indices: vec![],
            }),
            link_id: 4,
            upstream_id: 1,
            downstream_id: 0,
        },
        StreamFragmentEdge {
            dispatch_strategy: Some(DispatchStrategy {
                r#type: DispatcherType::Hash as i32,
                column_indices: vec![0],
            }),
            link_id: 1,
            upstream_id: 2,
            downstream_id: 1,
        },
    ]
}

fn make_stream_graph() -> StreamFragmentGraphProto {
    let fragments = make_stream_fragments();
    StreamFragmentGraphProto {
        fragments: HashMap::from_iter(fragments.into_iter().map(|f| (f.fragment_id, f))),
        edges: make_fragment_edges(),
        env: Some(StreamEnvironment::default()),
        dependent_table_ids: vec![],
        table_ids_cnt: 3,
        parallelism: None,
    }
}

fn make_cluster_info() -> StreamingClusterInfo {
    let parallel_units = (0..8)
        .map(|id| {
            (
                id,
                ParallelUnit {
                    id,
                    worker_node_id: 0,
                },
            )
        })
        .collect();
    let worker_nodes = std::iter::once((
        0,
        WorkerNode {
            id: 0,
            ..Default::default()
        },
    ))
    .collect();
    StreamingClusterInfo {
        worker_nodes,
        parallel_units,
    }
}

#[tokio::test]
async fn test_graph_builder() -> MetaResult<()> {
    let env = MetaSrvEnv::for_test().await;
    let parallel_degree = 4;
    let job = StreamingJob::Table(None, make_materialize_table(888));

    let graph = make_stream_graph();
    let fragment_graph = StreamFragmentGraph::new(graph, env.id_gen_manager_ref(), &job).await?;
    let internal_tables = fragment_graph.internal_tables();

    let actor_graph_builder = ActorGraphBuilder::new(
        CompleteStreamFragmentGraph::for_test(fragment_graph),
        make_cluster_info(),
        Some(NonZeroUsize::new(parallel_degree).unwrap()),
    )?;
    let ActorGraphBuildResult { graph, .. } = actor_graph_builder
        .generate_graph(env.id_gen_manager_ref(), &job)
        .await?;

    let table_fragments = TableFragments::for_test(TableId::default(), graph);
    let actors = table_fragments.actors();
    let barrier_inject_actor_ids = table_fragments.barrier_inject_actor_ids();
    let sink_actor_ids = table_fragments.mview_actor_ids();

    assert_eq!(actors.len(), 9);
    assert_eq!(barrier_inject_actor_ids, vec![6, 7, 8, 9]);
    assert_eq!(sink_actor_ids, vec![1]);
    assert_eq!(internal_tables.len(), 3);

    let fragment_upstreams: HashMap<_, _> = table_fragments
        .fragments
        .iter()
        .map(|(fragment_id, fragment)| (*fragment_id, fragment.upstream_fragment_ids.clone()))
        .collect();

    assert_eq!(fragment_upstreams.get(&1).unwrap(), &vec![2]);
    assert_eq!(fragment_upstreams.get(&2).unwrap(), &vec![3]);
    assert!(fragment_upstreams.get(&3).unwrap().is_empty());

    let mut expected_downstream = HashMap::new();
    expected_downstream.insert(1, vec![]);
    expected_downstream.insert(2, vec![1]);
    expected_downstream.insert(3, vec![1]);
    expected_downstream.insert(4, vec![1]);
    expected_downstream.insert(5, vec![1]);
    expected_downstream.insert(6, vec![2, 3, 4, 5]);
    expected_downstream.insert(7, vec![2, 3, 4, 5]);
    expected_downstream.insert(8, vec![2, 3, 4, 5]);
    expected_downstream.insert(9, vec![2, 3, 4, 5]);

    let mut expected_upstream = HashMap::new();
    expected_upstream.insert(1, vec![2, 3, 4, 5]);
    expected_upstream.insert(2, vec![6, 7, 8, 9]);
    expected_upstream.insert(3, vec![6, 7, 8, 9]);
    expected_upstream.insert(4, vec![6, 7, 8, 9]);
    expected_upstream.insert(5, vec![6, 7, 8, 9]);
    expected_upstream.insert(6, vec![]);
    expected_upstream.insert(7, vec![]);
    expected_upstream.insert(8, vec![]);
    expected_upstream.insert(9, vec![]);

    for actor in actors {
        println!("actor_id = {}", actor.get_actor_id());
        assert_eq!(
            expected_downstream.get(&actor.get_actor_id()).unwrap(),
            actor
                .dispatcher
                .first()
                .map_or(&vec![], |d| d.get_downstream_actor_id()),
        );
        let mut node = actor.get_nodes().unwrap();
        while !node.get_input().is_empty() {
            node = node.get_input().get(0).unwrap();
        }
        match node.get_node_body().unwrap() {
            NodeBody::Merge(merge_node) => {
                assert_eq!(
                    expected_upstream
                        .get(&actor.get_actor_id())
                        .unwrap()
                        .iter()
                        .collect::<HashSet<_>>(),
                    merge_node
                        .get_upstream_actor_id()
                        .iter()
                        .collect::<HashSet<_>>(),
                );
            }
            NodeBody::Source(_) => {
                // check nothing.
            }
            _ => {
                panic!("it should be MergeNode or SourceNode.");
            }
        }
    }

    Ok(())
}
