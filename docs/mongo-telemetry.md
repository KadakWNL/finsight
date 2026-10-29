# Scoped MongoDB Telemetry Reads and Aggregation

FinSight uses a dual-database architecture: PostgreSQL 17 serves as the primary system of record for relational, strictly constrained financial facts, customer accounts, and case investigations. MongoDB serves as the secondary document store for heterogeneous, semi-structured device telemetry collected during customer interactions.

This document describes the design, schema validator, indexes, aggregation pipeline, SQL-to-Mongo integration, offline resilience, and setup commands implemented under Issue #17.

---

## 1. Architectural Scope and Boundaries

Issue #17 provides a scoped telemetry read and aggregation capability:
- **Read-only telemetry access:** Telemetry data is queried solely to enrich transaction investigation context. No telemetry creation endpoints, mutation APIs, dual-write notes, or administrative deletion endpoints are exposed.
- **PostgreSQL as authority:** PostgreSQL resolves and authorizes transaction and device existence before MongoDB is queried. If a transaction has no associated `device_id`, MongoDB is not contacted.
- **Reference checks:** Within the latest 100 candidate documents, optional transaction references must exist in PostgreSQL and belong to the resolved device. Unknown or mismatched references are excluded before aggregation. Direct device reads without SQL authority include only samples without a transaction reference.
- **Time bounding:** MongoDB queries enforce a strict upper timestamp boundary matching the transaction's `occurred_at`. Future telemetry captured after the transaction occurred is never leaked into the investigation context.
- **Bounded aggregation:** All queries are bounded by explicit limits (`$limit: 100` before aggregation, five recent samples, and `maxTimeMS: 2000`) to eliminate runaway scan risks.
- **Graceful degradation:** If MongoDB is unreachable, misconfigured, or offline, the PostgreSQL-backed transaction detail and case investigation workflows continue without interruption. The telemetry section reports `status: "unavailable"` with a local UI warning.

---

## 2. Document Model and Schema Validation

Collection: `device_telemetry`

MongoDB enforces document structure at the storage layer via a strict JSON Schema validator (`$jsonSchema`), configured with `validationLevel: 'strict'` and `validationAction: 'error'`.

### Common Fields

Every telemetry document contains:
| Field | Type | Description |
|---|---|---|
| `_id` | string (UUID) | Unique document identifier. |
| `device_id` | string (UUID) | Foreign identifier referencing PostgreSQL `device_fingerprint(device_id)`. |
| `transaction_id` | string (UUID) or null | Optional transaction UUID associated with the telemetry snapshot. |
| `captured_at` | BSON Date | UTC timestamp when the telemetry was recorded on the client device. |
| `schema_version` | int32 | Schema version (currently `1`). |
| `shape_type` | string | Discriminator enum: `'connection_telemetry'` or `'client_environment'`. |
| `retention_eligible`| bool | Flag indicating whether this record is eligible for retention archiving. |
| `payload` | object | Polymorphic payload specific to `shape_type` (`additionalProperties: false`). |

### Shape 1: Connection Telemetry (`shape_type: "connection_telemetry"`)

Captures network and transport characteristics:
- `ip_routing_hash` (string, regex `^[0-9a-f]{64}$`): SHA-256 hash of network routing prefix (preserves privacy, no raw IP addresses).
- `connection_type` (string, enum: `'broadband'`, `'cellular'`, `'vpn'`, `'dialup'`).
- `latency_ms` (int32, minimum 0, maximum 10000): Round-trip latency in milliseconds.
- `tls_cipher` (string, 1-100 characters): Negotiated TLS cipher suite.
- `vpn_detected` (bool): Heuristic VPN/proxy flag.

### Shape 2: Client Environment (`shape_type: "client_environment"`)

Captures client operating environment and hardware properties:
- `screen_resolution` (string, regex `^\d{3,5}x\d{3,5}$`): Display dimensions (e.g., `'1920x1080'`).
- `battery_level` (int32, minimum 0, maximum 100): Battery charge percentage.
- `battery_charging` (bool): Battery power status.
- `os_patch_level` (string, regex `^\d{4}-\d{2}-\d{2}$`): Operating system patch date.
- `hardware_concurrency` (int32, minimum 1, maximum 256): Reported CPU logical core count.
- `user_agent_category` (string, enum: `'desktop_browser'`, `'mobile_browser'`, `'native_app'`).

---

## 3. Indexes

Three targeted indexes support high-throughput, bounded query patterns:

1. **`idx_device_captured_at`** (Compound):
   - Key: `{ device_id: 1, captured_at: -1 }`
   - Purpose: Serves primary lookup and time-bounded sorting for device-scoped investigations.
2. **`idx_transaction_id`** (Sparse):
   - Key: `{ transaction_id: 1 }`
   - Sparse: `true`
   - Purpose: Direct lookup when investigating transactions that explicitly recorded a transaction-scoped snapshot.
3. **`idx_retention_eligibility`** (Compound):
   - Key: `{ retention_eligible: 1, captured_at: 1 }`
   - Purpose: Supports eligibility inspection; automated retention processing is not implemented.

---

## 4. Bounded Aggregation Pipeline

Counts describe the latest 100 observations at or before the transaction time, not the full device history. There is no lower time bound.

The following excerpt illustrates the aggregation; the authoritative pipeline in [`src/server/telemetry.ts`](../src/server/telemetry.ts) uses a multi-faceted `$facet` stage to aggregate metrics and extract recent samples in one aggregation call after a bounded candidate read and SQL reference check:

```javascript
[
  // 1. Filter by device and enforce time bound (captured_at <= occurred_at)
  {
    $match: {
      device_id: deviceId,
      _id: { $in: allowedIds },
      captured_at: { $lte: maxDate }
    }
  },
  // 2. Sort by newest first
  { $sort: { captured_at: -1 } },
  // 3. Aggregate only the latest 100 observations
  { $limit: 100 },
  {
    $facet: {
      total_count: [{ $count: "count" }],
      time_range: [
        {
          $group: {
            _id: null,
            first_seen: { $min: "$captured_at" },
            last_seen: { $max: "$captured_at" }
          }
        }
      ],
      connection_summary: [
        { $match: { shape_type: "connection_telemetry" } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            vpn_detected_count: {
              $sum: { $cond: ["$payload.vpn_detected", 1, 0] }
            },
            avg_latency_ms: { $avg: "$payload.latency_ms" },
            connection_types: { $addToSet: "$payload.connection_type" }
          }
        }
      ],
      environment_summary: [
        { $match: { shape_type: "client_environment" } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            os_patch_levels: { $addToSet: "$payload.os_patch_level" },
            user_agent_categories: { $addToSet: "$payload.user_agent_category" }
          }
        }
      ],
      recent_samples: [
        { $limit: 5 },
        {
          $project: {
            _id: 0,
            shape_type: 1,
            captured_at: 1,
            transaction_id: 1,
            connection_type: "$payload.connection_type",
            vpn_detected: "$payload.vpn_detected",
            latency_ms: "$payload.latency_ms",
            os_patch_level: "$payload.os_patch_level",
            user_agent_category: "$payload.user_agent_category"
          }
        }
      ]
    }
  }
]
```

### Projections and Allowlisting
The `$project` stage strictly allowlists exported fields. IP routing hashes, full payloads, and internal MongoDB metadata are never returned to client components.

---

## 5. Offline Resilience and Error Isolation

MongoDB connectivity uses a pooled server client (`src/lib/mongo.ts`) configured with short fail-fast timeouts:
- `serverSelectionTimeoutMS: 2000`
- `connectTimeoutMS: 2000`
- `socketTimeoutMS: 5000`
- `maxPoolSize: 10`

### Resilience Matrix

| MongoDB State | Transaction API Behavior | Workspace UI Presentation |
|---|---|---|
| Configured & Online (with telemetry) | Returns transaction facts + `telemetry.status: "available"` | Renders metrics summary, VPN counts, average latency, and recent samples list. |
| Configured & Online (no telemetry for device) | Returns transaction facts + `telemetry.status: "no_data"` | Displays informational card: "No telemetry observations recorded for this device." |
| Offline / Unreachable / Unconfigured | Returns transaction facts + `telemetry.status: "unavailable"` | Displays warning card: "Telemetry unavailable (offline/unreachable); core transaction and risk evidence retained." |

At no point does a MongoDB timeout, disconnection, or failure abort the primary PostgreSQL transaction retrieval or case investigation flow.

---

## 6. Scripts and Verification

### Collection Setup
Creates the collection with the strict schema validator and builds all required indexes idempotently:
```powershell
npm run telemetry:setup
```

### Seeding Canonical Fixtures
Generates 12 deterministic, reproducible telemetry documents (6 connection, 6 client environment) for the canonical demo device `20000000-0000-0000-0000-000000000040`:
```powershell
npm run telemetry:seed
```

### Test Suites
```powershell
# Unit tests: Schema validation, shape constraints, index definitions
npm run test:unit -- tests/unit/mongo-telemetry.test.ts

# Integration tests: End-to-end API, time bounding, offline fallback, schema enforcement
npm run test:api -- tests/api/telemetry.test.ts
```
