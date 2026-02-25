# k-os: Scale Learning Lab — Full Curriculum (Tiers 1-7)

## Context

k-os is a personal lab monorepo for learning distributed systems at scale through Kubernetes. The curriculum maps directly to **Designing Data-Intensive Applications** (DDIA) by Martin Klemperer, giving hands-on muscle memory for the theory in the book.

**Tier 1 is implemented.** This plan covers Tiers 2-7: the DDIA-mapped expansion.

### Design Principles

- **Evolving architecture** — each tier adds infrastructure components (Redis, Postgres, Kafka, etc.)
- **Self-contained labs** — every lab has full setup instructions so you can revisit any lab independently
- **Explicit DDIA references** — each lab README cites specific chapters/sections
- **Builder depth** — implement simplified core algorithms (LSM-tree, 2PC, Raft, event log)
- **Go vs Rust comparison** — continues throughout all tiers

### Architecture Evolution

```
Tier 1: Browser → Ingress → Go API → Rust Processor
Tier 2:                    + Redis (cache), circuit breakers, protobuf
Tier 3:                    + Prometheus, Grafana, Jaeger, Loki (observability)
Tier 4:                    + PostgreSQL (primary + 2 replicas), LSM-tree service
Tier 5:                    + Shard Router → 3 PG shards, 2PC coordinator
Tier 6:                    + Chaos Mesh, Raft cluster (5 nodes)
Tier 7:                    + Kafka (Strimzi), Debezium CDC, event-log service
```

---

## Lab & Tier Overview

| Tier | Labs  | Theme                           | DDIA Chapters  | Builder Project       |
| ---- | ----- | ------------------------------- | -------------- | --------------------- |
| 1    | 01-05 | K8s Fundamentals                | —              | —                     |
| 2    | 06-10 | Resilience + Caching + Encoding | Ch 1, 4        | —                     |
| 3    | 11-14 | Observability                   | (Prerequisite) | —                     |
| 4    | 15-19 | Storage + Replication           | Ch 3, 4, 5     | LSM-tree KV store     |
| 5    | 20-24 | Partitioning + Transactions     | Ch 6, 7, 9     | 2PC coordinator       |
| 6    | 25-29 | Faults + Consensus              | Ch 8, 9        | Raft cluster          |
| 7    | 30-34 | Stream Processing               | Ch 10, 11      | Partitioned event log |

---

## Tier 2: Resilience Patterns + Caching + Encoding (DDIA Ch 1, 4)

**Architecture addition**: Redis, circuit breaker logic, protobuf encoding

```
Go API ─(circuit breaker)→ Rust Processor
   |
   +→ Redis (cache)
```

### New Components

- **Redis** — StatefulSet with PVC, used as cache between Go API and Rust Processor
- **Go API changes** — add `sony/gobreaker` circuit breaker, Redis client, `/circuit` endpoint
- **Rust Processor changes** — add `/slow` (configurable latency) and `/fail` (configurable error rate) endpoints
- **Protobuf** — `.proto` files for Go↔Rust communication, replacing JSON

### Labs

| Lab | Name                     | DDIA Ref            | Objective                                                                                          |
| --- | ------------------------ | ------------------- | -------------------------------------------------------------------------------------------------- |
| 06  | Circuit Breakers         | Ch 1 (reliability)  | Implement circuit breaker, observe Closed→Open→Half-Open transitions under degraded Rust service   |
| 07  | Retry Storms and Backoff | Ch 1 (reliability)  | Naive retries amplify failures 3x; exponential backoff with jitter fixes it                        |
| 08  | Rate Limiting            | Ch 1 (scalability)  | Ingress-level rate limiting (nginx annotations) + app-level token bucket, observe 429s             |
| 09  | Cache-Aside with Redis   | Ch 1 (tail latency) | Redis caching improves p50/p95/p99; expire all keys simultaneously → thundering herd               |
| 10  | Encoding Evolution       | Ch 4 (encoding)     | Switch Go↔Rust to protobuf, deploy mismatched schema versions, test forward/backward compatibility |

### New Tech

- Redis 7, `sony/gobreaker`, `protobuf`/`prost`, nginx rate limiting annotations

---

## Tier 3: Observability (Prerequisite Tier)

**Architecture addition**: Full observability plane

```
Prometheus → scrapes Go API, Rust Processor, Redis
Grafana → queries Prometheus, Loki, Jaeger
Jaeger → receives OTel traces
Loki + Promtail → centralized logs
```

### New Components

- **Prometheus** — raw K8s manifests (not Helm), scrape configs for all services
- **Grafana** — pre-provisioned dashboards, Loki + Jaeger data sources
- **Jaeger** — all-in-one deployment, receives OTLP on port 4317
- **Loki + Promtail** — DaemonSet ships pod logs to Loki
- **Service changes** — add Prometheus exposition format `/metrics`, OTel SDK for distributed tracing

### Labs

| Lab | Name                          | DDIA Ref            | Objective                                                                              |
| --- | ----------------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| 11  | Prometheus Metrics            | Ch 1 (quantitative) | Instrument services with RED metrics (Rate, Errors, Duration), build Grafana dashboard |
| 12  | Distributed Tracing           | Ch 8 (debugging)    | OTel traces across Go→Rust call chain, identify latency breakdown in Jaeger            |
| 13  | Log Aggregation with Loki     | —                   | Centralize structured logs, correlate logs with traces via trace_id                    |
| 14  | Grafana Dashboards & Alerting | Ch 1 (operability)  | Single-pane dashboard, alert rule: "error rate > 5% for 2 min"                         |

### New Tech

- Prometheus, Grafana, Jaeger, Loki, Promtail
- Go: `go.opentelemetry.io/otel`, `prometheus/client_golang`
- Rust: `opentelemetry`, `tracing-opentelemetry`, `metrics`, `prometheus` crates

---

## Tier 4: Storage, Replication & Encoding (DDIA Ch 3, 4, 5)

**Architecture addition**: PostgreSQL with streaming replication, LSM-tree builder project

```
Go API → PostgreSQL (primary)
              |
         PostgreSQL (replica-1)
              |
         PostgreSQL (replica-2)

kv-store (Rust LSM-tree, separate service)
```

### New Components

- **PostgreSQL primary** — StatefulSet, `wal_level=replica`, streaming replication
- **PostgreSQL replicas (2)** — StatefulSet, hot standby, replicate from primary
- **kv-store** — **Builder project**: Rust LSM-tree key-value store (~800 lines)
- **Go API changes** — add PostgreSQL client (`pgx`), write to primary, read from replicas

### Labs

| Lab | Name                               | DDIA Ref                 | Objective                                                                                      |
| --- | ---------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| 15  | PostgreSQL in K8s                  | Ch 3 (overview)          | Deploy PG as StatefulSet with PVC, understand StatefulSet vs Deployment for stateful workloads |
| 16  | Streaming Replication              | Ch 5 (leaders/followers) | Set up primary→replica replication, measure replication lag, promote a replica                 |
| 17  | Replication Lag & Read-Your-Writes | Ch 5 (replication lag)   | Implement 3 consistency strategies: route to primary, lag threshold, WAL position tracking     |
| 18  | **BUILD: LSM-Tree KV Store**       | Ch 3 (SSTables/LSM)      | Implement memtable, WAL, SSTable flush, compaction, read path in Rust                          |
| 19  | Schema Evolution Across Services   | Ch 4 (schema evolution)  | Protobuf field additions/removals, deploy mismatched versions, observe compatibility           |

### Builder Project: LSM-Tree KV Store (Lab 18)

- **Language**: Rust, **Size**: ~800 lines
- **Path**: `services/kv-store/`
- **Components**: In-memory memtable (BTreeMap), WAL (append-only file), SSTable writer/reader, compaction (merge-sort), REST API (axum): `PUT/GET/DELETE /kv/{key}`, debug endpoints
- **DDIA concepts**: Write amplification, read amplification, space amplification, write-ahead logging
- **Breakable**: Small memtable threshold → frequent flushes. Disable compaction → read latency degrades as SSTables grow.

---

## Tier 5: Partitioning & Transactions (DDIA Ch 6, 7, 9)

**Architecture addition**: Shard router, 3 PG shards, 2PC coordinator

```
Go API → Shard Router → PostgreSQL Shard 0
                      → PostgreSQL Shard 1
                      → PostgreSQL Shard 2

2PC Coordinator (Go) → Participant A (Go)
                     → Participant B (Rust)
```

### New Components

- **Shard Router** — Go service, hashes keys to determine shard, routes to correct PG instance
- **PostgreSQL Shards (3)** — independent StatefulSets, range-based and hash-based partitioning
- **2PC Coordinator** — **Builder project**: Go service with WAL for coordinator recovery (~700 lines)
- **2PC Participants** — Go (Participant A) + Rust (Participant B), each with local state

### Labs

| Lab | Name                           | DDIA Ref                    | Objective                                                                                                |
| --- | ------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| 20  | Hash Partitioning              | Ch 6 (hash of key)          | Distribute 10K records across 3 shards, observe even distribution                                        |
| 21  | Range Partitioning & Hot Spots | Ch 6 (key range)            | Switch to range partitioning, observe all timestamp-based writes hitting one shard                       |
| 22  | Rebalancing Partitions         | Ch 6 (rebalancing)          | Add 4th shard, migrate data without downtime, verify zero data loss                                      |
| 23  | Transaction Isolation Levels   | Ch 7 (weak isolation)       | Observe lost updates (READ COMMITTED), serialization errors (REPEATABLE READ), write skew (SERIALIZABLE) |
| 24  | **BUILD: 2PC Coordinator**     | Ch 7 + Ch 9 (atomic commit) | Implement prepare/commit/abort, kill coordinator mid-transaction, observe in-doubt state                 |

### Builder Project: 2PC Coordinator (Lab 24)

- **Language**: Go (coordinator + Participant A) + Rust (Participant B), **Size**: ~1000 lines total
- **Path**: `services/tx-coordinator/`, `services/tx-participant-go/`, `services/tx-participant-rust/`
- **Components**: Coordinator WAL, prepare/commit/abort HTTP RPC, failure injection endpoints (`/inject-failure?phase=after_prepare&action=crash`)
- **DDIA concepts**: Atomic commit, coordinator failure, in-doubt transactions, blocking protocol
- **Breakable**: Kill coordinator after PREPARE → both participants stuck. Restart → WAL recovery completes transaction.

---

## Tier 6: Faults & Consensus (DDIA Ch 8, 9)

**Architecture addition**: Chaos Mesh, Raft cluster (5 nodes)

```
Chaos Mesh (controller) → injects faults into any pod

raft-node-0 (leader)  ─┐
raft-node-1 (follower) ─┤ Raft cluster (StatefulSet, 5 pods)
raft-node-2 (follower) ─┤
raft-node-3 (follower) ─┤
raft-node-4 (follower) ─┘
```

### New Components

- **Chaos Mesh** — K8s-native chaos engineering: NetworkChaos, TimeChaos, StressChaos, PodChaos
- **raft-cluster** — **Builder project**: 5 Rust nodes implementing Raft consensus (~1000 lines)

### Labs

| Lab | Name                              | DDIA Ref                   | Objective                                                                                                    |
| --- | --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 25  | Network Delay & Partition         | Ch 8 (unreliable networks) | Chaos Mesh injects 500ms delay, then full partition between Go→Rust, observe circuit breaker + Jaeger traces |
| 26  | Clock Skew                        | Ch 8 (unreliable clocks)   | Skew Rust Processor clock +5min, observe TLS failures and log timestamp correlation breaking                 |
| 27  | Process Pauses & Split-Brain      | Ch 8 (process pauses)      | CPU stress simulates GC pause, pod loses K8s lease but doesn't know it, demonstrate split-brain              |
| 28  | Cascading Failure Under Chaos     | Ch 8 (fault models)        | Inject 3 faults simultaneously (Redis delay + Rust packet loss + PG stress), observe cascade and recovery    |
| 29  | **BUILD: Raft Consensus Cluster** | Ch 9 (Raft)                | Implement leader election, log replication, deploy 5 nodes, partition cluster, observe re-election           |

### Builder Project: Raft Consensus Cluster (Lab 29)

- **Language**: Rust, **Size**: ~1000 lines
- **Path**: `services/raft-node/`
- **Components**: State machine (Follower/Candidate/Leader), RequestVote RPC, AppendEntries RPC, log storage, commit tracking, randomized election timeouts, REST API for reads/writes
- **DDIA concepts**: Leader election, log replication, quorum, split-brain prevention, term numbers as logical clocks
- **Breakable**: Kill leader → re-election. Network partition → minority cannot make progress. Slow follower → replication lag.

---

## Tier 7: Stream Processing (DDIA Ch 10, 11)

**Architecture addition**: Kafka (Strimzi), Debezium CDC, event-log builder

```
Go API → Kafka (Strimzi, 3 brokers)
              ↑
         Debezium CDC ← PostgreSQL WAL
              ↓
         Go Event Consumer
         Rust Stream Processor (windowed aggregation)
         Batch Aggregator (Go, micro-batch)

event-log (Rust, partitioned append-only log)
```

### New Components

- **Kafka** (Strimzi) — 3-broker cluster, topics: `events.user-actions`, `events.processed`, `cdc.postgres.changes`
- **Debezium** — CDC connector capturing PostgreSQL WAL → Kafka
- **Go Event Consumer** — consumes events, implements consumer groups
- **Rust Stream Processor** — windowed aggregation (1-min tumbling windows)
- **Batch Aggregator** — Go, micro-batch every 30s (lighter Ch 10 coverage)
- **event-log** — **Builder project**: Rust partitioned append-only log (~800 lines)

### Labs

| Lab | Name                             | DDIA Ref                | Objective                                                                                       |
| --- | -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| 30  | Kafka in K8s (Strimzi)           | Ch 11 (message brokers) | Deploy 3-broker Kafka, produce/consume messages, verify partition ordering, kill a broker       |
| 31  | Event Sourcing                   | Ch 11 (event sourcing)  | Go API publishes events → Kafka → consumer materializes into PG, replay events to rebuild view  |
| 32  | Change Data Capture              | Ch 11 (CDC)             | Debezium captures PG WAL → Kafka, Rust consumer maintains search index from CDC events          |
| 33  | Windowed Aggregation             | Ch 11 (time/ordering)   | Rust stream processor with tumbling windows, observe late-arriving events, implement watermarks |
| 34  | **BUILD: Partitioned Event Log** | Ch 11 + Ch 10           | Implement partitions, append-only writes, consumer offsets, retention in Rust                   |

### Builder Project: Partitioned Event Log (Lab 34)

- **Language**: Rust, **Size**: ~800 lines
- **Path**: `services/event-log/`
- **Components**: Partition (append-only file per partition), message framing, offset index, consumer offset store, key-hash routing, segment rotation, retention policy
- **DDIA concepts**: Log-based messaging, partition ordering, consumer groups/offsets, exactly-once challenges
- **Breakable**: Single partition key → hot spot. Tiny segments → many small files. Disable retention → fill PVC.

---

## Builder Projects Summary

| #   | Name              | Tier/Lab | Language | ~Lines | Path                                      |
| --- | ----------------- | -------- | -------- | ------ | ----------------------------------------- |
| 1   | LSM-Tree KV Store | T4/L18   | Rust     | 800    | `services/kv-store/`                      |
| 2   | 2PC Coordinator   | T5/L24   | Go+Rust  | 1000   | `services/tx-coordinator/` + participants |
| 3   | Raft Cluster      | T6/L29   | Rust     | 1000   | `services/raft-node/`                     |
| 4   | Event Log         | T7/L34   | Rust     | 800    | `services/event-log/`                     |

---

## Kind Cluster Evolution

- **Tier 1-2**: 1 control-plane + 2 workers (current)
- **Tier 3**: Same, but observability adds resource pressure. Consider increasing Docker memory.
- **Tier 4+**: 1 control-plane + 3 workers. Update `kind-config.yaml` with `extraMounts` for PV local-path storage.

## Dashboard Evolution

Each tier adds a new section. Undeployed components show "not deployed" gracefully.

- **T2**: Circuit breaker state, cache hit/miss counters
- **T3**: Grafana links, trace IDs in event log
- **T4**: PG replication status, LSM-tree internals visualizer
- **T5**: Shard distribution chart, 2PC state diagram
- **T6**: Chaos Mesh status, Raft cluster state visualizer
- **T7**: Kafka topic/partition viewer, CDC stream, event-log visualizer

---

## Go vs Rust Comparison Points (Continued)

| Tier | Observation                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | Circuit breaker: Go goroutine-per-request vs Rust tokio task-per-request. Go's `gobreaker` is simpler; Rust requires more explicit async handling.  |
| 4    | PostgreSQL client: Go `pgx` pool (goroutine-safe) vs Rust `sqlx` (compile-time query checking).                                                     |
| 5    | 2PC: Go goroutines for concurrent participant communication vs Rust's sum types (enums) for modeling protocol states precisely.                     |
| 6    | Under chaos: Go's GC pauses compound with injected latency (longer tail latencies). Rust's no-GC means injected latency is the only latency source. |
| 7    | Kafka consumer: Go's goroutine-per-partition vs Rust's async polling with explicit backpressure control.                                            |

---

## Implementation Order

Each tier is a separate Graphite stack (or stack group). Implement one tier at a time:

1. **Tier 2** — Redis + circuit breaker + rate limiting + protobuf (extend existing services)
2. **Tier 3** — Observability stack (new infra, instrument existing services)
3. **Tier 4** — PostgreSQL + LSM-tree builder (new infra + new service)
4. **Tier 5** — Sharding + 2PC builder (new services)
5. **Tier 6** — Chaos Mesh + Raft builder (new infra + new service)
6. **Tier 7** — Kafka + CDC + event-log builder (new infra + new services)

---

## Verification

Each tier should pass:

- All lab READMEs are followable from scratch (self-contained setup)
- k6 load tests run and produce expected behavior
- Builder projects compile, deploy, and are breakable under stress
- Dashboard shows the new tier's visualizations
- DDIA chapter references are accurate and helpful
