#!/usr/bin/env bash
# Runs the blocker tests (task/tests/blockers.test.ts). Exit code 0 = all blockers pass.
# Usage (from anywhere): bash task/run_blockers.sh
#
# MongoDB runs in-process via mongodb-memory-server; nothing is downloaded at
# test time. In the Docker image the harness lives in /opt/blockers; locally
# it comes from docker/blockers-harness (npm ci there). To use an installed
# mongod instead of the cached one, set MONGOMS_SYSTEM_BINARY.
set -u
cd "$(dirname "$0")/.."

export MONGOMS_VERSION="${MONGOMS_VERSION:-7.0.14}"
export NODE_PATH="/opt/blockers/node_modules:$PWD/docker/blockers-harness/node_modules${NODE_PATH:+:$NODE_PATH}"

TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register task/tests/blockers.test.ts
