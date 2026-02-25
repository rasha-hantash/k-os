# Lab 02: Resource Limits & OOMKill

## Objective

Understand Kubernetes resource requests and limits, QoS classes, and what happens when pods exceed their memory ceiling.

## Theory

Every container in Kubernetes can declare two resource boundaries: **requests** and **limits**. Requests tell the scheduler the minimum resources a pod needs. The scheduler uses requests to decide which node has enough room for the pod. If no node can satisfy the request, the pod stays in Pending. Limits tell the kernel the maximum resources a container is allowed to use. For CPU, exceeding the limit means the container gets throttled. For memory, exceeding the limit means the kernel kills the process outright via the OOM killer.

Kubernetes assigns every pod a **Quality of Service (QoS) class** based on how requests and limits are configured. **Guaranteed** means every container has requests equal to limits for both CPU and memory -- this is the highest priority class and the last to be evicted under node pressure. **Burstable** means at least one container has requests set but they differ from limits. **BestEffort** means no requests or limits are set at all -- these pods are the first to be evicted when the node runs low on resources.

When a container exceeds its memory limit, the Linux kernel's OOM killer terminates the process. Kubernetes sees this as an **OOMKilled** exit reason and restarts the pod according to its restart policy. The key insight here is that Go and Rust behave differently under memory pressure. Go's garbage collector needs headroom beyond the actual data you allocate -- the GC metadata, goroutine stacks, and heap fragmentation mean Go may OOM well before you have allocated data equal to the memory limit. Rust has no garbage collector, so its memory usage is almost exactly what you allocate, letting it get much closer to the limit before being killed.

## Prerequisites

- Kind cluster running (via `./infra/setup.sh`)
- Images built and loaded into Kind (`./scripts/build-images.sh`)

## Setup

1. Deploy all services with tight memory limits:

   ```bash
   kubectl apply -f labs/02-resource-limits-oomkill/k8s/
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

1. **Check QoS classes.** Verify that Go API and Rust Processor are Guaranteed (requests == limits for memory):

   ```bash
   kubectl get pod -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.qosClass}{"\n"}{end}'
   ```

2. **Allocate memory on Go API.** Start small and increase:

   ```bash
   curl localhost/api/allocate?mb=10
   curl localhost/api/allocate?mb=20
   curl localhost/api/allocate?mb=30
   curl localhost/api/allocate?mb=40
   ```

3. **Watch for OOMKill.** In another terminal:

   ```bash
   kubectl get pods -w
   ```

4. **Inspect the killed pod.** Look for OOMKilled in the Last State section:

   ```bash
   kubectl describe pod -l app=go-api
   ```

5. **Test the Rust Processor.** Try allocating memory on the Rust side:

   ```bash
   curl localhost/api/crunch?mb=10
   curl localhost/api/crunch?mb=20
   ```

6. **Compare kill thresholds.** Note at what allocation size each service gets OOMKilled. Go should die earlier (around 50MB actual allocation with a 64Mi limit due to GC overhead). Rust should get much closer to its 32Mi limit.

7. **Release memory** (if the pod is still alive):

   ```bash
   curl localhost/api/allocate?release=true
   ```

## What to look for

- **OOMKilled status**: `kubectl get pods` shows OOMKilled in the STATUS column, then the pod restarts.
- **Restart count**: The RESTARTS column increments each time a pod is OOMKilled.
- **Kill threshold difference**: Go may die at around 40-50MB of actual allocation with a 64Mi limit because the GC needs extra headroom. Rust should survive closer to its 32Mi limit since there is no GC overhead.
- **Events**: `kubectl describe pod` shows the OOMKilled reason in the Last State section and events showing the container restarting.
- **QoS class**: Guaranteed pods are the last to be evicted, but even Guaranteed pods get OOMKilled if they exceed their own memory limit.

## Cleanup

```bash
kubectl delete -f labs/02-resource-limits-oomkill/k8s/
kubectl delete -f infra/ingress.yaml
```

## Further reading

- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Quality of Service for Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/)
- [Configure Default Memory Requests and Limits](https://kubernetes.io/docs/tasks/administer-cluster/manage-resources/memory-default-namespace/)
- [Troubleshooting OOMKilled](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/#my-pod-has-been-oomkilled)
