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

#![allow(rustdoc::private_intra_doc_links)]
#![allow(clippy::derive_partial_eq_without_eq)]
#![feature(binary_heap_retain)]
#![feature(iterator_try_collect)]
#![feature(trait_alias)]
#![feature(type_alias_impl_trait)]
#![feature(more_qualified_paths)]
#![feature(lint_reasons)]
#![feature(binary_heap_drain_sorted)]
#![feature(let_chains)]
#![feature(hash_drain_filter)]
#![feature(drain_filter)]
#![feature(generators)]
#![feature(proc_macro_hygiene)]
#![feature(stmt_expr_attributes)]
#![feature(allocator_api)]
#![feature(map_try_insert)]
#![feature(result_option_inspect)]
#![feature(never_type)]
#![feature(btreemap_alloc)]
#![feature(once_cell)]
#![feature(error_generic_member_access)]
#![feature(provide_any)]
#![feature(btree_drain_filter)]
#![feature(bound_map)]
#![feature(iter_order_by)]

#[macro_use]
extern crate tracing;

pub mod cache;
pub mod common;
pub mod error;
pub mod executor;
mod from_proto;
pub mod task;

/// Controls the behavior when a compute error happens.
///
/// - If set to `false`, `NULL` will be inserted.
/// - TODO: If set to `true`, The MV will be suspended and removed from further checkpoints. It can
///   still be used to serve outdated data without corruption.
///
/// See also <https://github.com/risingwavelabs/risingwave/issues/4625>.
#[expect(dead_code)]
const STRICT_MODE: bool = false;
