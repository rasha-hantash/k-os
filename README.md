# k-os — Scale Learning Lab

A personal lab monorepo for learning distributed systems fundamentals through Kubernetes. Deploy services, overwhelm them with load, watch them fail, learn to fix them.

## Architecture

```
Browser → Ingress (nginx) ─→ Dashboard (/)
                            └→ Go API (/api/*) → Rust Processor (internal)
```

Two backend services (Go vs Rust) under identical K8s constraints for comparing failure modes. A React dashboard for observability.

## Prerequisites

| Tool             | Install                                                           |
| ---------------- | ----------------------------------------------------------------- |
| Docker           | [docker.com](https://www.docker.com/)                             |
| Kind             | `brew install kind`                                               |
| kubectl          | `brew install kubectl`                                            |
| k6               | `brew install k6`                                                 |
| Go 1.22+         | `brew install go`                                                 |
| Rust (stable)    | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node 20+         | `brew install node`                                               |
| k9s (optional)   | `brew install k9s`                                                |
| stern (optional) | `brew install stern`                                              |

## Quickstart

```bash
# Create the cluster
./infra/setup.sh

# Build and load service images
./scripts/build-images.sh

# Start Lab 01
kubectl apply -f labs/01-deploy-and-stress/k8s/

# Run the load test
k6 run labs/01-deploy-and-stress/loadtest/stress.js
```

## Labs

| #   | Name                      | What you'll learn                         |
| --- | ------------------------- | ----------------------------------------- |
| 01  | Deploy & Stress           | Baseline deployment, k6 load testing      |
| 02  | Resource Limits & OOMKill | K8s resource requests/limits, QoS classes |
| 03  | Autoscaling (HPA)         | Horizontal Pod Autoscaler, metrics-server |
| 04  | Probes & Health Checks    | Liveness vs readiness probes              |
| 05  | Graceful Shutdown         | Zero-downtime rolling updates             |

## Services

- **go-api** — Go HTTP service (REST endpoints, structured logging, pprof)
- **rust-processor** — Rust data processing (axum, CPU/memory-intensive work)
- **dashboard** — React frontend (experiment control panel)

## Cleanup

```bash
./scripts/teardown.sh
```
