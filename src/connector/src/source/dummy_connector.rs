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

use anyhow::Result;
use async_trait::async_trait;
use futures::StreamExt;

use super::monitor::SourceMetrics;
use super::{SourceInfo, SplitImpl, SplitReaderV2};
use crate::parser::ParserConfig;
use crate::source::{BoxSourceWithStateStream, Column};

/// [`DummySplitReader`] is a placeholder for source executor that is assigned no split. It will
/// wait forever when calling `next`.
#[derive(Clone, Debug)]
pub struct DummySplitReader;

#[async_trait]
impl SplitReaderV2 for DummySplitReader {
    type Properties = ();

    async fn new(
        _properties: Self::Properties,
        _state: Vec<SplitImpl>,
        _parser_config: ParserConfig,
        _metrics: Arc<SourceMetrics>,
        _source_info: SourceInfo,
        _columns: Option<Vec<Column>>,
    ) -> Result<Self> {
        Ok(Self {})
    }

    fn into_stream(self) -> BoxSourceWithStateStream {
        futures::stream::pending().boxed()
    }
}
