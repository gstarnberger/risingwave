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

use std::fmt;

use risingwave_common::error::Result;
use risingwave_pb::batch_plan::plan_node::NodeBody;
use risingwave_pb::batch_plan::values_node::ExprTuple;
use risingwave_pb::batch_plan::ValuesNode;

use super::generic::GenericPlanRef;
use super::{
    ExprRewritable, LogicalValues, PlanBase, PlanRef, PlanTreeNodeLeaf, ToBatchProst,
    ToDistributedBatch,
};
use crate::expr::{Expr, ExprImpl, ExprRewriter};
use crate::optimizer::plan_node::ToLocalBatch;
use crate::optimizer::property::{Distribution, Order};

#[derive(Debug, Clone)]
pub struct BatchValues {
    pub base: PlanBase,
    logical: LogicalValues,
}

impl PlanTreeNodeLeaf for BatchValues {}
impl_plan_tree_node_for_leaf!(BatchValues);

impl BatchValues {
    pub fn new(logical: LogicalValues) -> Self {
        Self::with_dist(logical, Distribution::Single)
    }

    pub fn with_dist(logical: LogicalValues, dist: Distribution) -> Self {
        let ctx = logical.base.ctx.clone();
        let base = PlanBase::new_batch(ctx, logical.schema().clone(), dist, Order::any());
        BatchValues { base, logical }
    }

    /// Get a reference to the batch values's logical.
    #[must_use]
    pub fn logical(&self) -> &LogicalValues {
        &self.logical
    }

    fn row_to_protobuf(&self, row: &[ExprImpl]) -> ExprTuple {
        let cells = row
            .iter()
            .map(|x| {
                self.base
                    .ctx()
                    .expr_with_session_timezone(x.clone())
                    .to_expr_proto()
            })
            .collect();
        ExprTuple { cells }
    }
}

impl fmt::Display for BatchValues {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BatchValues")
            .field("rows", &self.logical.rows())
            .finish()
    }
}

impl ToDistributedBatch for BatchValues {
    fn to_distributed(&self) -> Result<PlanRef> {
        Ok(Self::with_dist(self.logical().clone(), Distribution::Single).into())
    }
}

impl ToBatchProst for BatchValues {
    fn to_batch_prost_body(&self) -> NodeBody {
        NodeBody::Values(ValuesNode {
            tuples: self
                .logical
                .rows()
                .iter()
                .map(|row| self.row_to_protobuf(row))
                .collect(),
            fields: self
                .logical
                .schema()
                .fields()
                .iter()
                .map(|f| f.to_prost())
                .collect(),
        })
    }
}

impl ToLocalBatch for BatchValues {
    fn to_local(&self) -> Result<PlanRef> {
        Ok(Self::with_dist(self.logical().clone(), Distribution::Single).into())
    }
}

impl ExprRewritable for BatchValues {
    fn has_rewritable_expr(&self) -> bool {
        true
    }

    fn rewrite_exprs(&self, r: &mut dyn ExprRewriter) -> PlanRef {
        Self::new(
            self.logical
                .rewrite_exprs(r)
                .as_logical_values()
                .unwrap()
                .clone(),
        )
        .into()
    }
}
