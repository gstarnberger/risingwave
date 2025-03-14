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

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use futures::{StreamExt, TryStreamExt};
use futures_async_stream::try_stream;
use risingwave_common::field_generator::FieldGeneratorImpl;
use risingwave_common::util::iter_util::zip_eq_fast;

use super::generator::DatagenEventGenerator;
use crate::impl_common_split_reader_logic;
use crate::parser::ParserConfig;
use crate::source::data_gen_util::spawn_data_generation_stream;
use crate::source::datagen::source::SEQUENCE_FIELD_KIND;
use crate::source::datagen::{DatagenProperties, DatagenSplit};
use crate::source::monitor::SourceMetrics;
use crate::source::{
    BoxSourceStream, BoxSourceWithStateStream, Column, DataType, SourceInfo, SplitId, SplitImpl,
    SplitMetaData, SplitReaderV2,
};

impl_common_split_reader_logic!(DatagenSplitReader, DatagenProperties);

pub struct DatagenSplitReader {
    generator: DatagenEventGenerator,
    assigned_split: DatagenSplit,

    split_id: SplitId,
    parser_config: ParserConfig,
    metrics: Arc<SourceMetrics>,
    source_info: SourceInfo,
}

#[async_trait]
impl SplitReaderV2 for DatagenSplitReader {
    type Properties = DatagenProperties;

    #[allow(clippy::unused_async)]
    async fn new(
        properties: DatagenProperties,
        splits: Vec<SplitImpl>,
        parser_config: ParserConfig,
        metrics: Arc<SourceMetrics>,
        source_info: SourceInfo,
        columns: Option<Vec<Column>>,
    ) -> Result<Self> {
        let mut assigned_split = DatagenSplit::default();
        let mut events_so_far = u64::default();
        tracing::debug!("Splits for datagen found! {:?}", splits);

        assert!(splits.len() == 1);
        let split = splits.into_iter().next().unwrap();
        // TODO: currently, assume there's only on split in one reader
        let split_id = split.id();
        if let SplitImpl::Datagen(n) = split {
            if let Some(s) = n.start_offset {
                // start_offset in `SplitImpl` indicates the latest successfully generated
                // index, so here we use start_offset+1
                events_so_far = s + 1;
            };
            assigned_split = n;
        }

        let split_index = assigned_split.split_index as u64;
        let split_num = assigned_split.split_num as u64;

        let rows_per_second = properties.rows_per_second;
        let fields_option_map = properties.fields;
        let mut fields_map = HashMap::<String, FieldGeneratorImpl>::new();

        // check columns
        assert!(columns.as_ref().is_some());
        let columns = columns.unwrap();

        // parse field connector option to build FieldGeneratorImpl
        // for example:
        // create table t1  (
        //     f_sequence INT,
        //     f_random INT,
        //    ) with (
        //     'connector' = 'datagen',
        // 'fields.f_sequence.kind'='sequence',
        // 'fields.f_sequence.start'='1',
        // 'fields.f_sequence.end'='1000',

        // 'fields.f_random.min'='1',
        // 'fields.f_random.max'='1000',
        // 'fields.f_random.seed'='12345',

        // 'fields.f_random_str.length'='10'
        // )

        for column in columns {
            let name = column.name.clone();
            let gen = generator_from_data_type(
                column.data_type,
                &fields_option_map,
                &name,
                split_index,
                split_num,
            )?;
            fields_map.insert(name, gen);
        }

        let generator = DatagenEventGenerator::new(
            fields_map,
            rows_per_second,
            events_so_far,
            split_id.clone(),
            split_num,
            split_index,
        )?;

        Ok(DatagenSplitReader {
            generator,
            assigned_split,
            split_id,
            parser_config,
            metrics,
            source_info,
        })
    }

    fn into_stream(self) -> BoxSourceWithStateStream {
        self.into_chunk_stream()
    }
}

impl DatagenSplitReader {
    pub(crate) fn into_data_stream(self) -> BoxSourceStream {
        // Will buffer at most 4 event chunks.
        const BUFFER_SIZE: usize = 4;
        spawn_data_generation_stream(self.generator.into_stream(), BUFFER_SIZE).boxed()
    }
}

fn generator_from_data_type(
    data_type: DataType,
    fields_option_map: &HashMap<String, String>,
    name: &String,
    split_index: u64,
    split_num: u64,
) -> Result<FieldGeneratorImpl> {
    let random_seed_key = format!("fields.{}.seed", name);
    let random_seed: u64 = match fields_option_map
        .get(&random_seed_key)
        .map(|s| s.to_string())
    {
        Some(seed) => {
            match seed.parse::<u64>() {
                // we use given seed xor split_index to make sure every split has different
                // seed
                Ok(seed) => seed ^ split_index,
                Err(e) => {
                    tracing::warn!(
                        "cannot parse {:?} to u64 due to {:?}, will use {:?} as random seed",
                        seed,
                        e,
                        split_index
                    );
                    split_index
                }
            }
        }
        None => split_index,
    };
    match data_type {
        DataType::Timestamp => {
            let max_past_key = format!("fields.{}.max_past", name);
            let max_past_value = fields_option_map.get(&max_past_key).map(|s| s.to_string());
            let max_past_mode_key = format!("fields.{}.max_past_mode", name);
            let max_past_mode_value = fields_option_map
                .get(&max_past_mode_key)
                .map(|s| s.to_lowercase());

            FieldGeneratorImpl::with_timestamp(max_past_value, max_past_mode_value, random_seed)
        }
        DataType::Varchar => {
            let length_key = format!("fields.{}.length", name);
            let length_value = fields_option_map.get(&length_key).map(|s| s.to_string());
            FieldGeneratorImpl::with_varchar(length_value, random_seed)
        }
        DataType::Struct(struct_type) => {
            let struct_fields =
                zip_eq_fast(struct_type.field_names.clone(), struct_type.fields.clone())
                    .map(|(field_name, data_type)| {
                        let gen = generator_from_data_type(
                            data_type,
                            fields_option_map,
                            &format!("{}.{}", name, field_name),
                            split_index,
                            split_num,
                        )?;
                        Ok((field_name, gen))
                    })
                    .collect::<Result<_>>()?;
            FieldGeneratorImpl::with_struct_fields(struct_fields)
        }
        DataType::List { datatype } => {
            let length_key = format!("fields.{}.length", name);
            let length_value = fields_option_map.get(&length_key).map(|s| s.to_string());
            let generator = generator_from_data_type(
                *datatype,
                fields_option_map,
                &format!("{}._", name),
                split_index,
                split_num,
            )?;
            FieldGeneratorImpl::with_list(generator, length_value)
        }
        _ => {
            let kind_key = format!("fields.{}.kind", name);
            if let Some(kind) = fields_option_map.get(&kind_key) && kind.as_str() == SEQUENCE_FIELD_KIND {
                let start_key = format!("fields.{}.start", name);
                let end_key = format!("fields.{}.end", name);
                let start_value =
                    fields_option_map.get(&start_key).map(|s| s.to_string());
                let end_value = fields_option_map.get(&end_key).map(|s| s.to_string());
                FieldGeneratorImpl::with_number_sequence(
                    data_type,
                    start_value,
                    end_value,
                    split_index,
                    split_num
                )
            } else {
                let min_key = format!("fields.{}.min", name);
                let max_key = format!("fields.{}.max", name);
                let min_value = fields_option_map.get(&min_key).map(|s| s.to_string());
                let max_value = fields_option_map.get(&max_key).map(|s| s.to_string());
                FieldGeneratorImpl::with_number_random(
                    data_type,
                    min_value,
                    max_value,
                    random_seed
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use maplit::{convert_args, hashmap};
    use risingwave_common::types::struct_type::StructType;

    use super::*;

    #[tokio::test]
    async fn test_generator() -> Result<()> {
        let mock_datum = vec![
            Column {
                name: "random_int".to_string(),
                data_type: DataType::Int32,
            },
            Column {
                name: "random_float".to_string(),
                data_type: DataType::Float32,
            },
            Column {
                name: "sequence_int".to_string(),
                data_type: DataType::Int32,
            },
            Column {
                name: "struct".to_string(),
                data_type: DataType::Struct(Arc::new(StructType {
                    fields: vec![DataType::Int32],
                    field_names: vec!["random_int".to_string()],
                })),
            },
        ];
        let state = vec![SplitImpl::Datagen(DatagenSplit {
            split_index: 0,
            split_num: 1,
            start_offset: None,
        })];
        let properties = DatagenProperties {
            split_num: None,
            rows_per_second: 10,
            fields: convert_args!(hashmap!(
                "fields.random_int.min" => "1",
                "fields.random_int.max" => "1000",
                "fields.random_int.seed" => "12345",

                "fields.random_float.min" => "1",
                "fields.random_float.max" => "1000",
                "fields.random_float.seed" => "12345",

                "fields.sequence_int.kind" => "sequence",
                "fields.sequence_int.start" => "1",
                "fields.sequence_int.end" => "1000",

                "fields.struct.random_int.min" => "1001",
                "fields.struct.random_int.max" => "2000",
                "fields.struct.random_int.seed" => "12345",
            )),
        };

        let mut reader = DatagenSplitReader::new(
            properties,
            state,
            Default::default(),
            Default::default(),
            Default::default(),
            Some(mock_datum),
        )
        .await?
        .into_data_stream();

        let msg = reader.next().await.unwrap().unwrap();
        assert_eq!(
            std::str::from_utf8(msg[0].payload.as_ref().unwrap().as_ref()).unwrap(),
            "{\"random_float\":533.1488647460938,\"random_int\":533,\"sequence_int\":1,\"struct\":{\"random_int\":1533}}"
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_random_deterministic() -> Result<()> {
        let mock_datum = vec![
            Column {
                name: "_".to_string(),
                data_type: DataType::Int64,
            },
            Column {
                name: "random_int".to_string(),
                data_type: DataType::Int32,
            },
        ];
        let state = vec![SplitImpl::Datagen(DatagenSplit {
            split_index: 0,
            split_num: 1,
            start_offset: None,
        })];
        let properties = DatagenProperties {
            split_num: None,
            rows_per_second: 10,
            fields: HashMap::new(),
        };
        let stream = DatagenSplitReader::new(
            properties.clone(),
            state,
            Default::default(),
            Default::default(),
            Default::default(),
            Some(mock_datum.clone()),
        )
        .await?
        .into_data_stream();

        let v1 = stream.skip(1).next().await.unwrap()?;

        let state = vec![SplitImpl::Datagen(DatagenSplit {
            split_index: 0,
            split_num: 1,
            start_offset: Some(9),
        })];
        let mut stream = DatagenSplitReader::new(
            properties,
            state,
            Default::default(),
            Default::default(),
            Default::default(),
            Some(mock_datum),
        )
        .await?
        .into_data_stream();
        let v2 = stream.next().await.unwrap()?;

        assert_eq!(v1, v2);
        Ok(())
    }
}
