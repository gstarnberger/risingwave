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

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, Result};

use super::{ExecuteContext, Task};
use crate::{KafkaConfig, KafkaGen};

pub struct KafkaService {
    config: KafkaConfig,
}

impl KafkaService {
    pub fn new(config: KafkaConfig) -> Result<Self> {
        Ok(Self { config })
    }

    fn kafka_path(&self) -> Result<PathBuf> {
        let prefix_bin = env::var("PREFIX_BIN")?;
        Ok(Path::new(&prefix_bin)
            .join("kafka")
            .join("bin")
            .join("kafka-server-start.sh"))
    }

    fn kafka(&self) -> Result<Command> {
        Ok(Command::new(self.kafka_path()?))
    }
}

impl Task for KafkaService {
    fn execute(&mut self, ctx: &mut ExecuteContext<impl std::io::Write>) -> anyhow::Result<()> {
        ctx.service(self);
        ctx.pb.set_message("starting...");

        let path = self.kafka_path()?;
        if !path.exists() {
            return Err(anyhow!("Kafka binary not found in {:?}\nDid you enable kafka feature in `./risedev configure`?", path));
        }

        let prefix_config = env::var("PREFIX_CONFIG")?;

        let path = if self.config.persist_data {
            Path::new(&env::var("PREFIX_DATA")?).join(self.id())
        } else {
            let path = Path::new("/tmp/risedev").join(self.id());
            std::fs::remove_dir_all(&path).ok();
            path
        };
        std::fs::create_dir_all(&path)?;

        let config_path = Path::new(&prefix_config).join(format!("{}.properties", self.id()));
        std::fs::write(
            &config_path,
            KafkaGen.gen_server_properties(&self.config, &path.to_string_lossy()),
        )?;

        let mut cmd = self.kafka()?;

        cmd.arg(config_path);

        ctx.run_command(ctx.tmux_run(cmd)?)?;

        ctx.pb.set_message("started");

        Ok(())
    }

    fn id(&self) -> String {
        self.config.id.clone()
    }
}
