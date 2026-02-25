#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="k-os"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Building Docker images..."

echo "→ Building go-api..."
docker build -t k-os/go-api:latest "$ROOT_DIR/services/go-api"

echo "→ Building rust-processor..."
docker build -t k-os/rust-processor:latest "$ROOT_DIR/services/rust-processor"

echo "→ Building dashboard..."
docker build -t k-os/dashboard:latest "$ROOT_DIR/services/dashboard"

echo "Loading images into Kind cluster..."
kind load docker-image k-os/go-api:latest --name "$CLUSTER_NAME"
kind load docker-image k-os/rust-processor:latest --name "$CLUSTER_NAME"
kind load docker-image k-os/dashboard:latest --name "$CLUSTER_NAME"

echo "Done! All images built and loaded into Kind cluster '$CLUSTER_NAME'."
