#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="k-os"

# --- Prerequisites -----------------------------------------------------------

for cmd in docker kind kubectl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is not installed. Please install it before running this script."
    exit 1
  fi
done

# --- Cluster setup ------------------------------------------------------------

echo "Deleting existing Kind cluster '$CLUSTER_NAME' (if any)..."
kind delete cluster --name "$CLUSTER_NAME" || true

echo "Creating Kind cluster '$CLUSTER_NAME'..."
kind create cluster --name "$CLUSTER_NAME" --config "$(dirname "$0")/kind-config.yaml"

echo "Waiting for all nodes to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=60s

# --- Ingress controller -------------------------------------------------------

echo "Installing nginx ingress controller..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

echo "Waiting for ingress controller to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

# --- Done ---------------------------------------------------------------------

echo ""
echo "Cluster '$CLUSTER_NAME' is ready!"
echo ""
echo "Verify with:"
echo "  kubectl get nodes"
echo "  kubectl get pods -n ingress-nginx"
