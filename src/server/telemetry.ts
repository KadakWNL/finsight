import 'server-only';
import type { Client } from 'pg';
import { getMongoDb } from '@/lib/mongo';
import {
  TELEMETRY_COLLECTION,
  isValidUuid,
  type TelemetryState,
  type TelemetrySummary,
  type ConnectionType,
  type UserAgentCategory,
} from '@/lib/telemetry-schema';

type SqlClient = Pick<Client, 'query'>;

export async function fetchDeviceTelemetryByDeviceId(
  deviceId: string,
  maxDate?: Date,
  sqlClient?: SqlClient
): Promise<TelemetryState> {
  if (!isValidUuid(deviceId)) {
    return {
      status: 'unavailable',
      message: 'Invalid device identifier.',
    };
  }

  try {
    const db = await getMongoDb();
    if (!db) {
      return {
        status: 'unavailable',
        message: 'Telemetry unavailable (offline/unreachable); core transaction and risk evidence retained.',
      };
    }

    const collection = db.collection(TELEMETRY_COLLECTION);
    const matchFilter: Record<string, unknown> = { device_id: deviceId };
    if (maxDate && !isNaN(maxDate.getTime())) {
      matchFilter.captured_at = { $lte: maxDate };
    }

    // Resolve optional document references against SQL within the same bounded window.
    // The transaction endpoint supplies SQL authority; direct device reads omit linked samples.
    const candidates = await collection.find(matchFilter, {
      projection: { _id: 1, transaction_id: 1 },
      maxTimeMS: 2000,
    }).sort({ captured_at: -1 }).limit(100).toArray();
    const references = [...new Set(candidates.map(doc => doc.transaction_id).filter(isValidUuid))];
    const verified = new Set<string>();
    if (sqlClient && references.length) {
      const result = await sqlClient.query<{ transaction_id: string }>(
        `SELECT transaction_id FROM public.transaction WHERE device_id = $1 AND transaction_id = ANY($2::uuid[])`,
        [deviceId, references]
      );
      for (const row of result.rows) verified.add(row.transaction_id);
    }
    const allowedIds = candidates
      .filter(doc => doc.transaction_id == null || verified.has(doc.transaction_id))
      .map(doc => doc._id);

    const pipeline = [
      { $match: { ...matchFilter, _id: { $in: allowedIds } } },
      { $sort: { captured_at: -1 } },
      { $limit: 100 },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                earliest: { $min: '$captured_at' },
                latest: { $max: '$captured_at' },
              },
            },
          ],
          connection: [
            { $match: { shape_type: 'connection_telemetry' } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                avg_latency: { $avg: '$payload.latency_ms' },
                min_latency: { $min: '$payload.latency_ms' },
                max_latency: { $max: '$payload.latency_ms' },
                vpn_count: {
                  $sum: { $cond: ['$payload.vpn_detected', 1, 0] },
                },
                connection_types: { $addToSet: '$payload.connection_type' },
              },
            },
          ],
          environment: [
            { $match: { shape_type: 'client_environment' } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                os_patch_levels: { $addToSet: '$payload.os_patch_level' },
                user_agent_categories: { $addToSet: '$payload.user_agent_category' },
              },
            },
          ],
          recent: [
            { $limit: 5 },
            {
              $project: {
                _id: 0,
                shape_type: 1,
                captured_at: 1,
                transaction_id: 1,
                connection_type: '$payload.connection_type',
                vpn_detected: '$payload.vpn_detected',
                latency_ms: '$payload.latency_ms',
                os_patch_level: '$payload.os_patch_level',
                user_agent_category: '$payload.user_agent_category',
              },
            },
          ],
        },
      },
    ];

    const results = await collection.aggregate(pipeline, { maxTimeMS: 2000 }).toArray();
    const facet = results[0];

    const total = facet?.summary?.[0]?.total ?? 0;
    if (total === 0) {
      return {
        status: 'no_data',
        message: 'No telemetry recorded for this device.',
      };
    }

    const conn = facet.connection?.[0];
    const env = facet.environment?.[0];
    const rawRecent = facet.recent ?? [];

    const summary: TelemetrySummary = {
      total_observations: total,
      time_window: {
        earliest: facet.summary[0]?.earliest instanceof Date
          ? facet.summary[0].earliest.toISOString()
          : (facet.summary[0]?.earliest ?? null),
        latest: facet.summary[0]?.latest instanceof Date
          ? facet.summary[0].latest.toISOString()
          : (facet.summary[0]?.latest ?? null),
      },
      connection_summary: {
        count: conn?.count ?? 0,
        avg_latency_ms: typeof conn?.avg_latency === 'number' ? Math.round(conn.avg_latency) : null,
        min_latency_ms: conn?.min_latency ?? null,
        max_latency_ms: conn?.max_latency ?? null,
        vpn_count: conn?.vpn_count ?? 0,
        connection_types: (conn?.connection_types ?? []).sort(),
      },
      environment_summary: {
        count: env?.count ?? 0,
        os_patch_levels: (env?.os_patch_levels ?? []).sort(),
        user_agent_categories: (env?.user_agent_categories ?? []).sort(),
      },
      recent_samples: rawRecent.map((item: Record<string, unknown>) => ({
        shape_type: item.shape_type as 'connection_telemetry' | 'client_environment',
        captured_at: item.captured_at instanceof Date ? item.captured_at.toISOString() : String(item.captured_at),
        transaction_id: item.transaction_id ? String(item.transaction_id) : null,
        connection_type: item.connection_type as ConnectionType | undefined,
        vpn_detected: typeof item.vpn_detected === 'boolean' ? item.vpn_detected : undefined,
        latency_ms: typeof item.latency_ms === 'number' ? item.latency_ms : undefined,
        os_patch_level: item.os_patch_level ? String(item.os_patch_level) : undefined,
        user_agent_category: item.user_agent_category as UserAgentCategory | undefined,
      })),
    };

    return {
      status: 'available',
      summary,
    };
  } catch {
    return {
      status: 'unavailable',
      message: 'Telemetry unavailable (offline/unreachable); core transaction and risk evidence retained.',
    };
  }
}

export async function getTransactionTelemetry(
  sqlClient: SqlClient,
  transactionId: string
): Promise<TelemetryState> {
  if (!isValidUuid(transactionId)) {
    return {
      status: 'unavailable',
      message: 'Invalid transaction identifier.',
    };
  }

  // 1. Authorize / Resolve SQL subject first through PostgreSQL
  const queryResult = await sqlClient.query<{ device_id: string; occurred_at: string }>(
    `SELECT t.device_id, to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
     FROM public.transaction t
     WHERE t.transaction_id = $1`,
    [transactionId]
  );

  if (queryResult.rows.length === 0) {
    return {
      status: 'unavailable',
      message: 'Referenced transaction does not exist in PostgreSQL.',
    };
  }

  const { device_id, occurred_at } = queryResult.rows[0];
  const maxDate = new Date(occurred_at);

  // 2. Query MongoDB with the verified device_id
  return fetchDeviceTelemetryByDeviceId(device_id, maxDate, sqlClient);
}
