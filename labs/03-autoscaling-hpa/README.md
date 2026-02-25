# Lab 03: Autoscaling (HPA)

## Objective

Set up a Horizontal Pod Autoscaler, watch it react to load in real time, and understand its scaling behavior.

## Theory

The Horizontal Pod Autoscaler (HPA) automatically adjusts the number of pod replicas based on observed metrics. It runs a control loop every 15 seconds by default: it reads the current metric value from the Metrics API, compares it to the target, and calculates the desired replica count. The formula is straightforward: `desiredReplicas = ceil(currentReplicas * (currentMetricValue / desiredMetricValue))`. If your target is 50% CPU and your pods are running at 80%, the HPA scales up. If they drop to 20%, it scales down.

The HPA depends on **metrics-server** to function. Metrics-server is a cluster add-on that collects resource utilization data (CPU and memory) from the kubelets on each node and exposes it through the Kubernetes Metrics API. Without metrics-server, the HPA has no data to work with and will report `<unknown>` for its metric values. In a Kind cluster, we need to install metrics-server manually and patch it with the `--kubelet-insecure-tls` flag because Kind uses self-signed certificates.

The HPA is deliberately asymmetric in its scaling behavior. **Scale-up is fast** -- it can happen within 15-30 seconds of detecting that metrics exceed the target. This is because unmet demand causes user-facing impact, so Kubernetes reacts quickly. **Scale-down is slow** -- there is a default stabilization window of 5 minutes before the HPA reduces replicas. This prevents flapping, where replicas scale up and down repeatedly in response to oscillating load. Understanding this asymmetry is critical for production tuning: aggressive scale-up with conservative scale-down is almost always the right default.

## Prerequisites

- Kind cluster running (via `./infra/setup.sh`)
- Images built and loaded into Kind (`./scripts/build-images.sh`)
- metrics-server installed (see Setup below)

## Setup

1. Install metrics-server (required for HPA to read CPU/memory metrics):

   ```bash
   kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
   ```

2. Patch metrics-server for Kind (self-signed certs):

   ```bash
   kubectl patch deployment metrics-server -n kube-system --type='json' \
     -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]'
   ```

3. Wait for metrics-server to be ready:

   ```bash
   kubectl wait --for=condition=Ready pod -l k8s-app=metrics-server -n kube-system --timeout=120s
   ```

4. Deploy all services with HPA:

   ```bash
   kubectl apply -f labs/03-autoscaling-hpa/k8s/
   ```

5. Deploy the ingress:

   ```bash
   kubectl apply -f infra/ingress.yaml
   ```

6. Wait for pods:

   ```bash
   kubectl wait --for=condition=Ready pods --all --timeout=60s
   ```

## Experiments

1. **Verify metrics-server works.** You should see CPU and memory values (it may take a minute after install):

   ```bash
   kubectl top pods
   ```

2. **Watch HPA status.** Open a dedicated terminal for this -- you will want to see it update in real time:

   ```bash
   kubectl get hpa --watch
   ```

3. **Run the sustained load test:**

   ```bash
   k6 run labs/03-autoscaling-hpa/loadtest/stress.js
   ```

4. **Watch replicas scale up.** In the HPA watch terminal, you should see the TARGETS column rise above 50% and the REPLICAS column increase. Cross-reference with:

   ```bash
   kubectl get pods -w
   ```

5. **After load stops, watch the cooldown.** It takes approximately 5 minutes before the HPA starts scaling down. Observe the stabilization window in action.

6. **Check HPA events** for details on scaling decisions:

   ```bash
   kubectl describe hpa go-api-hpa
   ```

## What to look for

- **HPA target vs actual**: `kubectl get hpa` shows both the target (50%) and current CPU utilization. Watch how the current value changes under load.
- **Scale-up speed**: How quickly does the HPA add replicas after load starts? It should be within 15-30 seconds.
- **Scale-down delay**: After load stops, the HPA waits ~5 minutes before reducing replicas. This is the stabilization window.
- **Replica oscillation**: If load is uneven, you might see replicas bounce up and down. The stabilization window is designed to prevent this.
- **Pod readiness**: New pods take a few seconds to start and become ready. During this window, existing pods bear all the load.

## Cleanup

```bash
kubectl delete -f labs/03-autoscaling-hpa/k8s/
kubectl delete -f infra/ingress.yaml
```

## Further reading

- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [HPA Walkthrough](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/)
- [Metrics Server](https://github.com/kubernetes-sigs/metrics-server)
- [Resource Metrics Pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/)
