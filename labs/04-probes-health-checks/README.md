# Lab 04: Probes & Health Checks

## Objective

Understand the difference between liveness and readiness probes and observe their cascading effects when misconfigured.

## Theory

Kubernetes uses **probes** to monitor the health of containers. There are two main types. **Liveness probes** answer the question "is this process dead?" If a liveness probe fails (exceeding the failure threshold), Kubernetes kills the container and restarts it. This is for cases where the process is stuck -- maybe it hit a deadlock or entered an infinite loop. The process is running but will never recover on its own, so the only fix is to restart it.

**Readiness probes** answer a different question: "can this process handle requests right now?" If a readiness probe fails, Kubernetes removes the pod from the Service's endpoints. No traffic is routed to it. But critically, the pod is NOT restarted -- it stays running. This is for cases where the process is temporarily unable to serve requests, like during startup, when it is warming a cache, or when a downstream dependency is unavailable. Once the readiness probe passes again, the pod is added back to the endpoints.

The most common misconfiguration is setting probes too aggressively. Short timeouts, low failure thresholds, and frequent checks can cause healthy pods to be killed or removed from traffic during normal load spikes. A pod doing CPU-intensive work might not respond to an HTTP health check within 1 second -- that does not mean it is dead. When aggressive liveness probes kill pods under load, you get a cascading failure: fewer pods means more load on the remaining pods, which makes their probes fail too, which kills more pods. This is worse than having no probes at all. **CrashLoopBackOff** occurs when a pod keeps crashing and Kubernetes backs off the restart interval exponentially (10s, 20s, 40s, up to 5 minutes), giving the system time to recover rather than burning resources on constant restarts.

## Prerequisites

- Kind cluster running (via `./infra/setup.sh`)
- Images built and loaded into Kind (`./scripts/build-images.sh`)

## Setup

This lab deploys variants one at a time to observe each behavior in isolation. Start with the correct probes and work through each misconfiguration.

1. Deploy the ingress:

   ```bash
   kubectl apply -f infra/ingress.yaml
   ```

## Experiments

### Experiment 1: Correct probes

Deploy all services with properly configured probes:

```bash
kubectl apply -f labs/04-probes-health-checks/k8s/correct-probes.yaml
```

Verify everything works:

```bash
kubectl get pods
curl localhost/api/health
curl localhost/
```

Check probe configuration:

```bash
kubectl describe pod -l app=go-api | grep -A 5 "Liveness\|Readiness"
```

Clean up before the next experiment:

```bash
kubectl delete -f labs/04-probes-health-checks/k8s/correct-probes.yaml
```

### Experiment 2: Broken liveness probe

Deploy Go API with a liveness probe pointing at a non-existent endpoint:

```bash
kubectl apply -f labs/04-probes-health-checks/k8s/broken-liveness.yaml
```

Watch Kubernetes restart the pod in a loop:

```bash
kubectl get pods -w
```

Check the probe failure events:

```bash
kubectl describe pod -l app=go-api
```

Look for:

- The liveness probe failure messages in Events
- `Last State: Terminated` with `Reason: Error`
- The restart count climbing
- Eventually, CrashLoopBackOff status with increasing back-off delays

Clean up:

```bash
kubectl delete -f labs/04-probes-health-checks/k8s/broken-liveness.yaml
```

### Experiment 3: Broken readiness probe

Deploy Go API with a readiness probe pointing at a non-existent endpoint:

```bash
kubectl apply -f labs/04-probes-health-checks/k8s/broken-readiness.yaml
```

The pod stays running, but gets no traffic:

```bash
kubectl get pods          # STATUS is Running, READY is 0/1
kubectl get endpoints go-api   # No endpoints listed
curl localhost/api/health      # Returns 502 from ingress (no backends)
```

Check events:

```bash
kubectl describe pod -l app=go-api
```

Look for: readiness probe failure events, but no restarts.

Clean up:

```bash
kubectl delete -f labs/04-probes-health-checks/k8s/broken-readiness.yaml
```

### Experiment 4: Aggressive probes under load

Deploy Go API with overly aggressive probes (1-second timeout, 1 failure threshold):

```bash
kubectl apply -f labs/04-probes-health-checks/k8s/aggressive-probes.yaml
```

Under no load, this might seem fine. But add some work:

```bash
# Hit it with requests that take 500ms to process
for i in $(seq 1 20); do curl -s localhost/api/work?duration_ms=500 & done
```

Watch Kubernetes kill the pod because it cannot respond to the probe within 1 second while handling requests:

```bash
kubectl get pods -w
kubectl describe pod -l app=go-api
```

Clean up:

```bash
kubectl delete -f labs/04-probes-health-checks/k8s/aggressive-probes.yaml
```

## What to look for

- **Liveness failure = restart**: The pod gets killed and restarted. The restart count climbs. Eventually CrashLoopBackOff kicks in.
- **Readiness failure = no traffic**: The pod stays running (READY 0/1) but receives no traffic. The Service has no endpoints. Requests get 502 from the ingress.
- **CrashLoopBackOff timing**: Watch the back-off interval increase: 10s, 20s, 40s, 80s, up to 5 minutes.
- **Aggressive probes cause outages**: Under load, a healthy pod gets killed because it cannot respond to probes fast enough. This is worse than having no probes at all because it removes capacity exactly when you need it most.

## Cleanup

```bash
kubectl delete -f labs/04-probes-health-checks/k8s/correct-probes.yaml 2>/dev/null
kubectl delete -f labs/04-probes-health-checks/k8s/broken-liveness.yaml 2>/dev/null
kubectl delete -f labs/04-probes-health-checks/k8s/broken-readiness.yaml 2>/dev/null
kubectl delete -f labs/04-probes-health-checks/k8s/aggressive-probes.yaml 2>/dev/null
kubectl delete -f infra/ingress.yaml
```

## Further reading

- [Configure Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [CrashLoopBackOff](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#restart-policy)
