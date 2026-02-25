#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="k-os"

echo "Deleting Kind cluster '$CLUSTER_NAME'..."
kind delete cluster --name "$CLUSTER_NAME"

echo "Cluster '$CLUSTER_NAME' deleted."
