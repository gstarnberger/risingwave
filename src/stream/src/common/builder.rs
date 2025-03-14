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

use risingwave_common::array::{ArrayBuilderImpl, Op, StreamChunk};
use risingwave_common::row::Row;
use risingwave_common::types::{DataType, Datum};
use risingwave_common::util::iter_util::ZipEqFast;

type IndexMappings = Vec<(usize, usize)>;

/// Build a array and it's corresponding operations.
pub struct StreamChunkBuilder {
    /// operations in the data chunk to build
    ops: Vec<Op>,

    /// arrays in the data chunk to build
    column_builders: Vec<ArrayBuilderImpl>,

    /// Data types of columns
    data_types: Vec<DataType>,

    /// The column index mapping from update side to output.
    update_to_output: IndexMappings,

    /// The column index mapping from matched side to output.
    matched_to_output: IndexMappings,

    /// Maximum capacity of column builder
    capacity: usize,

    /// Size of column builder
    size: usize,
}

impl Drop for StreamChunkBuilder {
    fn drop(&mut self) {
        // Possible to fail in some corner cases but should not in unit tests
        debug_assert_eq!(self.size, 0, "dropping non-empty stream chunk builder");
    }
}

impl StreamChunkBuilder {
    pub fn new(
        capacity: usize,
        data_types: &[DataType],
        update_to_output: IndexMappings,
        matched_to_output: IndexMappings,
    ) -> Self {
        // Leave room for paired `UpdateDelete` and `UpdateInsert`. When there are `capacity - 1`
        // ops in current builder and the last op is `UpdateDelete`, we delay the chunk generation
        // until `UpdateInsert` comes. This means that the effective output message size will indeed
        // be at most the original `capacity`
        let reduced_capacity = capacity - 1;
        assert!(reduced_capacity > 0);

        let ops = Vec::with_capacity(reduced_capacity);
        let column_builders = data_types
            .iter()
            .map(|datatype| datatype.create_array_builder(reduced_capacity))
            .collect();
        Self {
            ops,
            column_builders,
            data_types: data_types.to_owned(),
            update_to_output,
            matched_to_output,
            capacity: reduced_capacity,
            size: 0,
        }
    }

    /// Get the mapping from left/right input indices to the output indices.
    pub fn get_i2o_mapping(
        output_indices: impl Iterator<Item = usize>,
        left_len: usize,
        right_len: usize,
    ) -> (IndexMappings, IndexMappings) {
        let mut left_to_output = vec![];
        let mut right_to_output = vec![];

        for (output_idx, idx) in output_indices.enumerate() {
            if idx < left_len {
                left_to_output.push((idx, output_idx))
            } else if idx >= left_len && idx < left_len + right_len {
                right_to_output.push((idx - left_len, output_idx));
            } else {
                unreachable!("output_indices out of bound")
            }
        }
        (left_to_output, right_to_output)
    }

    /// Increase chunk size
    ///
    /// A [`StreamChunk`] will be returned when `size == capacity`
    #[must_use]
    fn inc_size(&mut self) -> Option<StreamChunk> {
        self.size += 1;

        // Take a chunk when capacity is exceeded, but splitting `UpdateDelete` and `UpdateInsert`
        // should be avoided
        if self.size >= self.capacity && self.ops[self.ops.len() - 1] != Op::UpdateDelete {
            self.take()
        } else {
            None
        }
    }

    /// Append a row with coming update value and matched value
    ///
    /// A [`StreamChunk`] will be returned when `size == capacity`
    #[must_use]
    pub fn append_row(
        &mut self,
        op: Op,
        row_update: impl Row,
        row_matched: impl Row,
    ) -> Option<StreamChunk> {
        self.ops.push(op);
        for &(update_idx, output_idx) in &self.update_to_output {
            self.column_builders[output_idx].append_datum(row_update.datum_at(update_idx));
        }
        for &(matched_idx, output_idx) in &self.matched_to_output {
            self.column_builders[output_idx].append_datum(row_matched.datum_at(matched_idx));
        }

        self.inc_size()
    }

    /// Append a row with coming update value and fill the other side with null.
    ///
    /// A [`StreamChunk`] will be returned when `size == capacity`
    #[must_use]
    pub fn append_row_update(&mut self, op: Op, row_update: impl Row) -> Option<StreamChunk> {
        self.ops.push(op);
        for &(update_idx, output_idx) in &self.update_to_output {
            self.column_builders[output_idx].append_datum(row_update.datum_at(update_idx));
        }
        for &(_matched_idx, output_idx) in &self.matched_to_output {
            self.column_builders[output_idx].append_datum(Datum::None);
        }

        self.inc_size()
    }

    /// append a row with matched value and fill the coming side with null.
    ///
    /// A [`StreamChunk`] will be returned when `size == capacity`
    #[must_use]
    pub fn append_row_matched(&mut self, op: Op, row_matched: impl Row) -> Option<StreamChunk> {
        self.ops.push(op);
        for &(_update_idx, output_idx) in &self.update_to_output {
            self.column_builders[output_idx].append_datum(Datum::None);
        }
        for &(matched_idx, output_idx) in &self.matched_to_output {
            self.column_builders[output_idx].append_datum(row_matched.datum_at(matched_idx));
        }

        self.inc_size()
    }

    #[must_use]
    pub fn take(&mut self) -> Option<StreamChunk> {
        if self.size == 0 {
            return None;
        }

        self.size = 0;
        let new_columns = self
            .column_builders
            .iter_mut()
            .zip_eq_fast(&self.data_types)
            .map(|(builder, datatype)| {
                std::mem::replace(builder, datatype.create_array_builder(self.capacity)).finish()
            })
            .map(Into::into)
            .collect::<Vec<_>>();

        Some(StreamChunk::new(
            std::mem::take(&mut self.ops),
            new_columns,
            None,
        ))
    }
}
