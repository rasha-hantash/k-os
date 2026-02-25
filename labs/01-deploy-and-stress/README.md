# Lab 01: Deploy & Stress

## Objective

Get both services running in Kind, hit them with load, and establish a performance baseline.

## Theory

Kubernetes Deployments are the standard way to run stateless applications. When you create a Deployment, the scheduler assigns pods to nodes based on available resources, the kubelet on each node pulls the container images and starts the containers, and the Deployment controller ensures the desired number of replicas are always running. If a pod crashes, the controller replaces it automatically.

Services provide stable networking for pods. A ClusterIP service (the default type) gives your pods a stable internal DNS name and IP address. When other pods inside the cluster call `go-api:80`, Kubernetes routes that traffic to one of the healthy pods backing the service. This decouples service discovery from individual pod lifecycles -- pods can come and go, but the Service address stays the same.

In this lab we use generous resource limits to establish a baseline. We want to know how our services perform when they have plenty of CPU and memory, before we start constraining them in later labs. This baseline gives us a reference point: if things break in Lab 02 or 03, we know it is because of the constraints we introduced, not because the services are fundamentally broken.

## Prerequisites

- Kind cluster running (via `./infra/setup.sh`)
- Images built and loaded into Kind (`./scripts/build-images.sh`)

## Setup

1. Deploy all services:

   ```bash
   kubectl apply -f labs/01-deploy-and-stress/k8s/
   ```

2. Deploy the ingress:

   ```bash
   kubectl apply -f infra/ingress.yaml
   ```

3. Wait for all pods to be ready:

   ```bash
   kubectl wait --for=condition=Ready pods --all --timeout=60s
   ```

4. Verify the services are responding:

   ```bash
   curl localhost/api/health
   curl localhost/
   ```

## Experiments

1. **Check pod status.** See which nodes your pods landed on:

   ```bash
   kubectl get pods -o wide
   ```

2. **Check resource usage.** This requires metrics-server, which we install in Lab 03. If it is not installed yet, skip this step:

   ```bash
   kubectl top pods
   ```

3. **Hit endpoints manually.** Verify the Go API and dashboard respond correctly:

   ```bash
   curl localhost/api/health
   curl localhost/api/work?duration_ms=50
   curl localhost/
   ```

4. **Run the k6 load test:**

   ```bash
   k6 run labs/01-deploy-and-stress/loadtest/stress.js
   ```

5. **Watch pods during the test.** In another terminal:

   ```bash
   kubectl get pods -w
   ```

6. **Check logs after the test:**

   ```bash
   kubectl logs -l app=go-api --tail=50
   ```

7. **Compare Go API vs Rust Processor response times.** Look at the k6 output for the `go_api_duration` trend metric and compare it to overall `http_req_duration`.

## What to look for

- **Response time distribution**: What are the p50, p95, and p99 latencies? These are your baseline numbers.
- **Error rate**: You should see zero or near-zero errors with generous resource limits.
- **Throughput ceiling**: How many requests per second can the system handle before latency degrades?
- **Memory and CPU growth**: Do the pods use more resources as load increases? Do they stabilize or keep growing?
- **Go vs Rust**: The Rust processor should show lower and more consistent latency since there is no garbage collector introducing pauses.

## Cleanup

```bash
kubectl delete -f labs/01-deploy-and-stress/k8s/
kubectl delete -f infra/ingress.yaml
```

## Further reading

- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Services](https://kubernetes.io/docs/concepts/services-networking/service/)
- [Managing Resources for Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [kubectl Cheat Sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
