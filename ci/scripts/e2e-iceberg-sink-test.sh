#!/usr/bin/env bash

# Exits as soon as any line fails.
set -euo pipefail

source ci/scripts/common.env.sh

while getopts 'p:' opt; do
    case ${opt} in
        p )
            profile=$OPTARG
            ;;
        \? )
            echo "Invalid Option: -$OPTARG" 1>&2
            exit 1
            ;;
        : )
            echo "Invalid option: $OPTARG requires an argument" 1>&2
            ;;
    esac
done
shift $((OPTIND -1))

echo "--- Download artifacts"
mkdir -p target/debug
buildkite-agent artifact download risingwave-"$profile" target/debug/
buildkite-agent artifact download risedev-dev-"$profile" target/debug/
mv target/debug/risingwave-"$profile" target/debug/risingwave
mv target/debug/risedev-dev-"$profile" target/debug/risedev-dev

echo "--- Download connector node jar"
buildkite-agent artifact download connector-service.jar ./

echo "--- Adjust permission"
chmod +x ./target/debug/risingwave
chmod +x ./target/debug/risedev-dev

echo "--- Generate RiseDev CI config"
cp ci/risedev-components.ci.source.env risedev-components.user.env

echo "--- Prepare RiseDev dev cluster"
cargo make pre-start-dev
cargo make link-all-in-one-binaries

echo "--- starting risingwave cluster with connector node"
cargo make ci-start ci-iceberg-test
java -jar ./connector-service.jar --port 60061 > .risingwave/log/connector-sink.log 2>&1 &
sleep 1

# prepare minio iceberg sink
echo "--- preparing iceberg"
.risingwave/bin/mcli -C .risingwave/config/mcli mb hummock-minio/iceberg
wget https://downloads.apache.org/spark/spark-3.3.1/spark-3.3.1-bin-hadoop3.tgz
tar -xf spark-3.3.1-bin-hadoop3.tgz --no-same-owner
DEPENDENCIES=org.apache.iceberg:iceberg-spark-runtime-3.3_2.12:1.0.0,org.apache.hadoop:hadoop-aws:3.3.2
spark-3.3.1-bin-hadoop3/bin/spark-sql --packages $DEPENDENCIES \
    --conf spark.sql.catalog.demo=org.apache.iceberg.spark.SparkCatalog \
    --conf spark.sql.catalog.demo.type=hadoop \
    --conf spark.sql.catalog.demo.warehouse=s3a://iceberg/ \
    --conf spark.sql.catalog.demo.hadoop.fs.s3a.endpoint=http://127.0.0.1:9301 \
    --conf spark.sql.catalog.demo.hadoop.fs.s3a.access.key=hummockadmin \
    --conf spark.sql.catalog.demo.hadoop.fs.s3a.secret.key=hummockadmin \
    --S --e "CREATE TABLE demo.demo_db.demo_table(v1 int, v2 int) TBLPROPERTIES ('format-version'='2');"

echo "--- testing sinks"
sqllogictest -p 4566 -d dev './e2e_test/sink/iceberg_sink.slt'
sleep 1

# check sink destination iceberg
spark-3.3.1-bin-hadoop3/bin/spark-sql --packages $DEPENDENCIES \
    --conf spark.sql.catalog.demo=org.apache.iceberg.spark.SparkCatalog \
    --conf spark.sql.catalog.demo.type=hadoop \
    --conf spark.sql.catalog.demo.warehouse=s3a://iceberg/ \
    --conf spark.sql.catalog.demo.hadoop.fs.s3a.endpoint=http://127.0.0.1:9301 \
    --conf spark.sql.catalog.demo.hadoop.fs.s3a.access.key=hummockadmin \
    --conf spark.sql.catalog.demo.hadoop.fs.s3a.secret.key=hummockadmin \
    --S --e "INSERT OVERWRITE DIRECTORY './spark-output' USING CSV SELECT * FROM demo.demo_db.demo_table;" 

# check sink destination using shell
if cat ./spark-output/*.csv | sort | awk -F "," '{
if ($1 == 1 && $2 == 2) c1++;
 if ($1 == 13 && $2 == 2) c2++;
  if ($1 == 21 && $2 == 2) c3++;
   if ($1 == 2 && $2 == 2) c4++;
    if ($1 == 3 && $2 == 2) c5++;
     if ($1 == 5 && $2 == 2) c6++;
      if ($1 == 8 && $2 == 2) c7++; }
       END { exit !(c1 == 1 && c2 == 1 && c3 == 1 && c4 == 1 && c5 == 1 && c6 == 1 && c7 == 1); }'; then
  echo "Iceberg sink check passed"
else
  echo "The output is not as expected."
  exit 1
fi

echo "--- Kill cluster"
pkill -f connector-service.jar
cargo make ci-kill
