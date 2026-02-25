# Lab 05: Graceful Shutdown

## Objective

Achieve zero-downtime deployments under load by understanding the pod termination sequence and configuring graceful shutdown correctly.

## Theory

When Kubernetes performs a rolling update, it creates new pods, waits for them to pass their readiness probes, then terminates old pods. The termination sequence has five steps: (1) the pod is marked for deletion, (2) the pod is removed from Service endpoints so new traffic stops being routed to it, (3) a SIGTERM signal is sent to the container's main process, (4) the container has `terminationGracePeriodSeconds` to finish in-flight work and shut down cleanly, and (5) if the container is still running after the grace period, Kubernetes sends SIGKILL to force-kill it.

The critical problem is a **race condition** between steps 2 and 3. When the pod is marked for deletion, two things happen concurrently: the endpoints controller starts removing the pod from Service endpoints, and the kubelet sends SIGTERM. But the endpoints update is asynchronous -- it has to propagate through the kube-proxy or ingress controller, and that takes time. During this window (typically a few hundred milliseconds to a few seconds), the pod is already shutting down but still receiving traffic. Requests that arrive during this window get connection resets or 502 errors.

The solution is a **preStop hook**. By adding a `lifecycle.preStop` hook that runs `sleep 5`, you delay the SIGTERM by 5 seconds. This gives the endpoints controller enough time to propagate the removal before the pod starts shutting down. Combined with proper connection draining in the application (Go's `http.Server.Shutdown()` finishes in-flight requests before exiting, and Rust's tokio provides similar graceful shutdown), you can achieve truly zero-downtime deployments. The `terminationGracePeriodSeconds` must be long enough to cover the preStop delay plus the time needed to drain connections.

## Prerequisites

- Kind cluster running (via `./infra/setup.sh`)
- Images built and loaded into Kind (`./scripts/build-images.sh`)
- k6 installed for load testing

## Setup

1. Deploy the non-graceful version first:

   ```bash
   kubectl apply -f labs/05-graceful-shutdown/k8s/
   ```

2. Deploy the ingress:

   ```bash
   kubectl apply -f infra/ingress.yaml
   ```

3. Wait for pods:

   ```bash
   kubectl wait --for=condition=Ready pods --all --timeout=60s
   ```

## Experiments

### Experiment 1: Rolling update WITHOUT graceful shutdown

1. Start constant k6 load (runs for 3 minutes):

   ```bash
   k6 run labs/05-graceful-shutdown/loadtest/stress.js
   ```

2. While load is running (in another terminal), trigger a rolling update by changing an env var:

   ```bash
   kubectl set env deployment/go-api DEPLOY_VERSION=v2
   ```

3. Watch the k6 output for errors -- you should see 502 responses and connection resets during the deployment.

4. Note the error count and error rate from the k6 summary.

### Experiment 2: Rolling update WITH graceful shutdown

1. Deploy the graceful version:

   ```bash
   kubectl apply -f labs/05-graceful-shutdown/k8s/go-api-graceful.yaml
   ```

2. Wait for the rollout to complete:

   ```bash
   kubectl rollout status deployment/go-api
   ```

3. Start k6 load again:

   ```bash
   k6 run labs/05-graceful-shutdown/loadtest/stress.js
   ```

4. While load is running, trigger another rolling update:

   ```bash
   kubectl set env deployment/go-api DEPLOY_VERSION=v3
   ```

5. Watch the k6 output -- you should see zero or near-zero errors this time.

6. Compare the error counts between Experiment 1 and Experiment 2.

### Experiment 3: Inspect the termination sequence

1. Watch pod events in detail during a rollout:

   ```bash
   kubectl get pods -w
   ```

2. In another terminal, describe a terminating pod to see the preStop hook execution:

   ```bash
   kubectl describe pod -l app=go-api
   ```

3. Look at the events section for:
   - `Killing` event with the grace period noted
   - `preStop` hook execution

## What to look for

- **Error count during deployment**: The non-graceful version should show several 502 and connection reset errors. The graceful version should show zero or near-zero.
- **502/504 responses**: These come from the ingress when it routes to a pod that is already shutting down.
- **Connection reset errors**: These happen when the pod closes its network socket while a request is in flight.
- **preStop hook effect**: The 5-second sleep gives endpoints time to propagate, eliminating the race condition.
- **terminationGracePeriodSeconds**: With the non-graceful version (1 second), the pod gets SIGKILL almost immediately. With the graceful version (30 seconds), there is plenty of time for the preStop hook (5s) plus connection draining.
- **Go vs Rust**: Both languages support graceful shutdown, but Go's `http.Server.Shutdown()` drains connections automatically, while Rust requires explicit tokio graceful shutdown handling.

## Cleanup

```bash
kubectl delete -f labs/05-graceful-shutdown/k8s/
kubectl delete -f infra/ingress.yaml
```

## Further reading

- [Pod Lifecycle - Termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
- [Container Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/)
- [Rolling Updates](https://kubernetes.io/docs/tutorials/kubernetes-basics/update/update-intro/)
- [Graceful Shutdown in Kubernetes (blog)](https://learnk8s.io/graceful-shutdown)
