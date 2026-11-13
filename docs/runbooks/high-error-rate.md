# ShopWave API High Error Rate Runbook

## Alert

`ShopWaveHighErrorRate` fires when the ShopWave API HTTP 5xx error rate
exceeds 5% for two minutes.

## 1. Check API pod health

```bash
kubectl get pods -n shopwave -o wide
kubectl get deployments -n shopwave
kubectl get endpoints api -n shopwave
```

Check for unavailable replicas, restarts, Pending pods, or missing endpoints.

## 2. Inspect API logs

```bash
kubectl logs deployment/api -n shopwave \
  --all-containers=true --since=15m
```

Look for database connection errors, Redis failures, SQS errors,
uncaught exceptions, and repeated HTTP 5xx responses.

## 3. Inspect pod events

```bash
kubectl describe deployment api -n shopwave
kubectl get events -n shopwave --sort-by=.lastTimestamp
```

Check for failed probes, resource limits, scheduling problems,
image errors, and container restarts.

## 4. Check application secrets

```bash
kubectl get externalsecret shopwave-secrets -n shopwave
kubectl get secret shopwave-secrets -n shopwave
```

Verify that the ExternalSecret is synchronized. Do not print or share
the contents of Kubernetes Secrets.

## 5. Check Prometheus metrics

Inspect the API 5xx rate:

```promql
sum(rate(http_requests_total{namespace="shopwave",status_code=~"5.."}[5m]))
/
clamp_min(sum(rate(http_requests_total{namespace="shopwave"}[5m])), 0.000001)
```

Inspect request volume and latency to determine whether the issue
is isolated to a route or affecting the entire API.

## 6. Recovery

Identify the cause before restarting or rolling back workloads.

If a recent deployment caused the issue, inspect its rollout history:

```bash
kubectl rollout history deployment/api -n shopwave
```

When GitOps is active, revert the relevant image-manifest change through
Git so the desired state and cluster state remain consistent.

For an emergency manual rollback before GitOps is active, coordinate
the rollback and update the Kubernetes manifest afterwards.

## 7. Resolution criteria

- API pods are Ready.
- Deployment available replicas match the expected count.
- API endpoints are present.
- HTTP 5xx rate has returned below the alert threshold.
- The alert has resolved in Alertmanager.
- The cause and corrective action are documented.
