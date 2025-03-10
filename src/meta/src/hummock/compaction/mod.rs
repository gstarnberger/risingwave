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

pub mod compaction_config;
mod level_selector;
mod overlap_strategy;
mod prost_type;
use risingwave_hummock_sdk::prost_key_range::KeyRangeExt;
use risingwave_pb::hummock::compact_task::{self, TaskStatus};

mod picker;
use std::collections::{HashMap, HashSet};
use std::fmt::{Debug, Formatter};
use std::sync::Arc;

use picker::{
    LevelCompactionPicker, ManualCompactionPicker, MinOverlappingPicker, TierCompactionPicker,
};
use risingwave_hummock_sdk::{CompactionGroupId, HummockCompactionTaskId, HummockEpoch};
use risingwave_pb::hummock::compaction_config::CompactionMode;
use risingwave_pb::hummock::hummock_version::Levels;
use risingwave_pb::hummock::{CompactTask, CompactionConfig, InputLevel, KeyRange, LevelType};

pub use crate::hummock::compaction::level_selector::{
    selector_option, DynamicLevelSelector, LevelSelector, ManualCompactionSelector, SelectorOption,
    SpaceReclaimCompactionSelector, TtlCompactionSelector,
};
use crate::hummock::compaction::overlap_strategy::{OverlapStrategy, RangeOverlapStrategy};
use crate::hummock::level_handler::LevelHandler;
use crate::rpc::metrics::MetaMetrics;

pub struct CompactStatus {
    compaction_group_id: CompactionGroupId,
    pub(crate) level_handlers: Vec<LevelHandler>,
}

impl Debug for CompactStatus {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CompactStatus")
            .field("compaction_group_id", &self.compaction_group_id)
            .field("level_handlers", &self.level_handlers)
            .finish()
    }
}

impl PartialEq for CompactStatus {
    fn eq(&self, other: &Self) -> bool {
        self.level_handlers.eq(&other.level_handlers)
            && self.compaction_group_id == other.compaction_group_id
    }
}

impl Clone for CompactStatus {
    fn clone(&self) -> Self {
        Self {
            compaction_group_id: self.compaction_group_id,
            level_handlers: self.level_handlers.clone(),
        }
    }
}

pub struct CompactionInput {
    pub input_levels: Vec<InputLevel>,
    pub target_level: usize,
    pub target_sub_level_id: u64,
}

impl CompactionInput {
    pub fn add_pending_task(&self, task_id: u64, level_handlers: &mut [LevelHandler]) {
        for level in &self.input_levels {
            level_handlers[level.level_idx as usize].add_pending_task(
                task_id,
                self.target_level,
                &level.table_infos,
            );
        }
    }
}

pub struct CompactionTask {
    pub input: CompactionInput,
    pub compression_algorithm: String,
    pub target_file_size: u64,
    pub compaction_task_type: compact_task::TaskType,
}

pub fn create_overlap_strategy(compaction_mode: CompactionMode) -> Arc<dyn OverlapStrategy> {
    match compaction_mode {
        CompactionMode::Range => Arc::new(RangeOverlapStrategy::default()),
        CompactionMode::Unspecified => unreachable!(),
    }
}

impl CompactStatus {
    pub fn new(compaction_group_id: CompactionGroupId, max_level: u64) -> CompactStatus {
        let mut level_handlers = vec![];
        for level in 0..=max_level {
            level_handlers.push(LevelHandler::new(level as u32));
        }
        CompactStatus {
            compaction_group_id,
            level_handlers,
        }
    }

    pub fn get_compact_task(
        &mut self,
        levels: &Levels,
        task_id: HummockCompactionTaskId,
        compaction_group_id: CompactionGroupId,
        stats: &mut LocalSelectorStatistic,
        selector: &mut Box<dyn LevelSelector>,
    ) -> Option<CompactTask> {
        // When we compact the files, we must make the result of compaction meet the following
        // conditions, for any user key, the epoch of it in the file existing in the lower
        // layer must be larger.
        let ret = selector.pick_compaction(task_id, levels, &mut self.level_handlers, stats)?;
        let target_level_id = ret.input.target_level;

        let compression_algorithm = match ret.compression_algorithm.as_str() {
            "Lz4" => 1,
            "Zstd" => 2,
            _ => 0,
        };

        let compact_task = CompactTask {
            input_ssts: ret.input.input_levels,
            splits: vec![KeyRange::inf()],
            watermark: HummockEpoch::MAX,
            sorted_output_ssts: vec![],
            task_id,
            target_level: target_level_id as u32,
            // only gc delete keys in last level because there may be older version in more bottom
            // level.
            gc_delete_keys: target_level_id == self.level_handlers.len() - 1,
            task_status: TaskStatus::Pending as i32,
            compaction_group_id,
            existing_table_ids: vec![],
            compression_algorithm,
            target_file_size: ret.target_file_size,
            compaction_filter_mask: 0,
            table_options: HashMap::default(),
            current_epoch_time: 0,
            target_sub_level_id: ret.input.target_sub_level_id,
            task_type: ret.compaction_task_type as i32,
        };
        Some(compact_task)
    }

    pub fn is_trivial_move_task(task: &CompactTask) -> bool {
        if task.input_ssts.len() != 2
            || task.input_ssts[0].level_type != LevelType::Nonoverlapping as i32
        {
            return false;
        }

        // it may be a manual compaction task
        if task.input_ssts[0].level_idx == task.input_ssts[1].level_idx
            && task.input_ssts[0].level_idx > 0
        {
            return false;
        }

        if task.input_ssts[1].level_idx == task.target_level
            && task.input_ssts[1].table_infos.is_empty()
        {
            return true;
        }

        false
    }

    /// Declares a task as either succeeded, failed or canceled.
    pub fn report_compact_task(&mut self, compact_task: &CompactTask) {
        for level in &compact_task.input_ssts {
            self.level_handlers[level.level_idx as usize].remove_task(compact_task.task_id);
        }
    }

    pub fn cancel_compaction_tasks_if<F: Fn(u64) -> bool>(&mut self, should_cancel: F) -> u32 {
        let mut count: u32 = 0;
        for level in &mut self.level_handlers {
            for pending_task_id in level.pending_tasks_ids() {
                if should_cancel(pending_task_id) {
                    level.remove_task(pending_task_id);
                    count += 1;
                }
            }
        }
        count
    }

    pub fn compaction_group_id(&self) -> CompactionGroupId {
        self.compaction_group_id
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ManualCompactionOption {
    /// Filters out SSTs to pick. Has no effect if empty.
    pub sst_ids: Vec<u64>,
    /// Filters out SSTs to pick.
    pub key_range: KeyRange,
    /// Filters out SSTs to pick. Has no effect if empty.
    pub internal_table_id: HashSet<u32>,
    /// Input level.
    pub level: usize,
}

impl Default for ManualCompactionOption {
    fn default() -> Self {
        Self {
            sst_ids: vec![],
            key_range: KeyRange {
                left: vec![],
                right: vec![],
                right_exclusive: false,
            },
            internal_table_id: HashSet::default(),
            level: 1,
        }
    }
}

#[derive(Default)]
pub struct LocalPickerStatistic {
    skip_by_write_amp_limit: u64,
    skip_by_count_limit: u64,
    skip_by_pending_files: u64,
    skip_by_overlapping: u64,
}

#[derive(Default)]
pub struct LocalSelectorStatistic {
    skip_picker: Vec<(usize, usize, LocalPickerStatistic)>,
}

impl LocalSelectorStatistic {
    pub fn report_to_metrics(&self, group_id: u64, metrics: &MetaMetrics) {
        for (start_level, target_level, stats) in &self.skip_picker {
            let level_label = format!("cg{}-{}-to-{}", group_id, start_level, target_level);
            if stats.skip_by_count_limit > 0 {
                metrics
                    .compact_skip_frequency
                    .with_label_values(&[level_label.as_str(), "write-amp"])
                    .inc_by(stats.skip_by_write_amp_limit);
            }
            if stats.skip_by_write_amp_limit > 0 {
                metrics
                    .compact_skip_frequency
                    .with_label_values(&[level_label.as_str(), "count"])
                    .inc_by(stats.skip_by_count_limit);
            }
            if stats.skip_by_pending_files > 0 {
                metrics
                    .compact_skip_frequency
                    .with_label_values(&[level_label.as_str(), "pending-files"])
                    .inc_by(stats.skip_by_pending_files);
            }
            if stats.skip_by_overlapping > 0 {
                metrics
                    .compact_skip_frequency
                    .with_label_values(&[level_label.as_str(), "overlapping"])
                    .inc_by(stats.skip_by_overlapping);
            }
            metrics
                .compact_skip_frequency
                .with_label_values(&[level_label.as_str(), "picker"])
                .inc();
        }
    }
}

pub trait CompactionPicker {
    fn pick_compaction(
        &mut self,
        levels: &Levels,
        level_handlers: &[LevelHandler],
        stats: &mut LocalPickerStatistic,
    ) -> Option<CompactionInput>;
}

pub fn create_compaction_task(
    compaction_config: &CompactionConfig,
    input: CompactionInput,
    base_level: usize,
    compaction_task_type: compact_task::TaskType,
) -> CompactionTask {
    let target_file_size = if input.target_level == 0 {
        compaction_config.target_file_size_base
    } else {
        assert!(input.target_level >= base_level);
        let step = (input.target_level - base_level) / 2;
        compaction_config.target_file_size_base << step
    };
    let compression_algorithm = if input.target_level == 0 {
        compaction_config.compression_algorithm[0].clone()
    } else {
        let idx = input.target_level - base_level + 1;
        compaction_config.compression_algorithm[idx].clone()
    };

    CompactionTask {
        input,
        compression_algorithm,
        target_file_size,
        compaction_task_type,
    }
}
