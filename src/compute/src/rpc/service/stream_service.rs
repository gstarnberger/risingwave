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

use std::sync::Arc;

use async_stack_trace::StackTrace;
use itertools::Itertools;
use risingwave_common::error::tonic_err;
use risingwave_hummock_sdk::table_stats::to_prost_table_stats_map;
use risingwave_hummock_sdk::LocalSstableInfo;
use risingwave_pb::stream_service::barrier_complete_response::GroupedSstableInfo;
use risingwave_pb::stream_service::stream_service_server::StreamService;
use risingwave_pb::stream_service::*;
use risingwave_storage::dispatch_state_store;
use risingwave_stream::error::StreamError;
use risingwave_stream::executor::Barrier;
use risingwave_stream::task::{LocalStreamManager, StreamEnvironment};
use tonic::{Request, Response, Status};

#[derive(Clone)]
pub struct StreamServiceImpl {
    mgr: Arc<LocalStreamManager>,
    env: StreamEnvironment,
}

impl StreamServiceImpl {
    pub fn new(mgr: Arc<LocalStreamManager>, env: StreamEnvironment) -> Self {
        StreamServiceImpl { mgr, env }
    }
}

#[async_trait::async_trait]
impl StreamService for StreamServiceImpl {
    #[cfg_attr(coverage, no_coverage)]
    async fn update_actors(
        &self,
        request: Request<UpdateActorsRequest>,
    ) -> std::result::Result<Response<UpdateActorsResponse>, Status> {
        let req = request.into_inner();
        let res = self
            .mgr
            .update_actors(&req.actors, &req.hanging_channels)
            .await;
        match res {
            Err(e) => {
                error!("failed to update stream actor {}", e);
                Err(e.into())
            }
            Ok(()) => Ok(Response::new(UpdateActorsResponse { status: None })),
        }
    }

    #[cfg_attr(coverage, no_coverage)]
    async fn build_actors(
        &self,
        request: Request<BuildActorsRequest>,
    ) -> std::result::Result<Response<BuildActorsResponse>, Status> {
        let req = request.into_inner();

        let actor_id = req.actor_id;
        let res = self
            .mgr
            .build_actors(actor_id.as_slice(), self.env.clone())
            .await;
        match res {
            Err(e) => {
                error!("failed to build actors {}", e);
                Err(e.into())
            }
            Ok(()) => Ok(Response::new(BuildActorsResponse {
                request_id: req.request_id,
                status: None,
            })),
        }
    }

    #[cfg_attr(coverage, no_coverage)]
    async fn broadcast_actor_info_table(
        &self,
        request: Request<BroadcastActorInfoTableRequest>,
    ) -> std::result::Result<Response<BroadcastActorInfoTableResponse>, Status> {
        let req = request.into_inner();

        let res = self.mgr.update_actor_info(&req.info).await;
        match res {
            Err(e) => {
                error!("failed to update actor info table actor {}", e);
                Err(e.into())
            }
            Ok(()) => Ok(Response::new(BroadcastActorInfoTableResponse {
                status: None,
            })),
        }
    }

    #[cfg_attr(coverage, no_coverage)]
    async fn drop_actors(
        &self,
        request: Request<DropActorsRequest>,
    ) -> std::result::Result<Response<DropActorsResponse>, Status> {
        let req = request.into_inner();
        let actors = req.actor_ids;
        self.mgr.drop_actor(&actors).await?;
        Ok(Response::new(DropActorsResponse {
            request_id: req.request_id,
            status: None,
        }))
    }

    #[cfg_attr(coverage, no_coverage)]
    async fn force_stop_actors(
        &self,
        request: Request<ForceStopActorsRequest>,
    ) -> std::result::Result<Response<ForceStopActorsResponse>, Status> {
        let req = request.into_inner();
        self.mgr.stop_all_actors().await?;
        self.env.dml_manager_ref().clear();
        Ok(Response::new(ForceStopActorsResponse {
            request_id: req.request_id,
            status: None,
        }))
    }

    #[cfg_attr(coverage, no_coverage)]
    async fn inject_barrier(
        &self,
        request: Request<InjectBarrierRequest>,
    ) -> Result<Response<InjectBarrierResponse>, Status> {
        let req = request.into_inner();
        let barrier =
            Barrier::from_protobuf(req.get_barrier().unwrap()).map_err(StreamError::from)?;

        self.mgr
            .send_barrier(&barrier, req.actor_ids_to_send, req.actor_ids_to_collect)?;

        Ok(Response::new(InjectBarrierResponse {
            request_id: req.request_id,
            status: None,
        }))
    }

    #[cfg_attr(coverage, no_coverage)]
    async fn barrier_complete(
        &self,
        request: Request<BarrierCompleteRequest>,
    ) -> Result<Response<BarrierCompleteResponse>, Status> {
        let req = request.into_inner();
        let (collect_result, checkpoint) = self
            .mgr
            .collect_barrier(req.prev_epoch)
            .stack_trace(format!("collect_barrier (epoch {})", req.prev_epoch))
            .await
            .inspect_err(|err| tracing::error!("failed to collect barrier: {}", err))?;
        // Must finish syncing data written in the epoch before respond back to ensure persistence
        // of the state.
        let synced_sstables = if checkpoint {
            self.mgr
                .sync_epoch(req.prev_epoch)
                .stack_trace(format!("sync_epoch (epoch {})", req.prev_epoch))
                .await?
        } else {
            vec![]
        };

        Ok(Response::new(BarrierCompleteResponse {
            request_id: req.request_id,
            status: None,
            create_mview_progress: collect_result.create_mview_progress,
            synced_sstables: synced_sstables
                .into_iter()
                .map(
                    |LocalSstableInfo {
                         compaction_group_id,
                         sst_info,
                         table_stats,
                     }| GroupedSstableInfo {
                        compaction_group_id,
                        sst: Some(sst_info),
                        table_stats_map: to_prost_table_stats_map(table_stats),
                    },
                )
                .collect_vec(),
            worker_id: self.env.worker_id(),
        }))
    }

    #[cfg_attr(coverage, no_coverage)]
    async fn wait_epoch_commit(
        &self,
        request: Request<WaitEpochCommitRequest>,
    ) -> Result<Response<WaitEpochCommitResponse>, Status> {
        let epoch = request.into_inner().epoch;

        dispatch_state_store!(self.env.state_store(), store, {
            use risingwave_hummock_sdk::HummockReadEpoch;
            use risingwave_storage::StateStore;

            store
                .try_wait_epoch(HummockReadEpoch::Committed(epoch))
                .stack_trace(format!("wait_epoch_commit (epoch {})", epoch))
                .await
                .map_err(tonic_err)?;
        });

        Ok(Response::new(WaitEpochCommitResponse { status: None }))
    }
}
