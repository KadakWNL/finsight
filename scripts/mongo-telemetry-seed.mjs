import { syntheticId } from './financial-seed.mjs';
import { MongoClient } from 'mongodb';
import {
  TELEMETRY_COLLECTION,
  validateTelemetryDoc,
} from './telemetry-schema.mjs';
import { setupMongoTelemetry } from './mongo-telemetry-setup.mjs';

export function generateCanonicalTelemetryFixtures(deviceId = syntheticId(40)) {
  const connectionSamples = [
    {
      id: '70000000-0000-0000-0000-000000000001',
      transaction_id: syntheticId(100),
      captured_at: new Date('2025-12-28T14:22:10Z'),
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: {
        ip_routing_hash: 'a'.repeat(64),
        connection_type: 'broadband',
        latency_ms: 28,
        tls_cipher: 'TLS_AES_256_GCM_SHA384',
        vpn_detected: false,
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000002',
      transaction_id: syntheticId(101),
      captured_at: new Date('2025-12-29T09:15:40Z'),
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: {
        ip_routing_hash: 'b'.repeat(64),
        connection_type: 'cellular',
        latency_ms: 72,
        tls_cipher: 'TLS_AES_128_GCM_SHA256',
        vpn_detected: false,
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000003',
      transaction_id: syntheticId(102),
      captured_at: new Date('2025-12-30T18:44:00Z'),
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: {
        ip_routing_hash: 'c'.repeat(64),
        connection_type: 'broadband',
        latency_ms: 35,
        tls_cipher: 'TLS_AES_256_GCM_SHA384',
        vpn_detected: false,
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000004',
      transaction_id: syntheticId(103),
      captured_at: new Date('2025-12-31T22:10:05Z'),
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: {
        ip_routing_hash: 'd'.repeat(64),
        connection_type: 'vpn',
        latency_ms: 145,
        tls_cipher: 'ECDHE-RSA-AES256-GCM-SHA384',
        vpn_detected: true,
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000005',
      transaction_id: syntheticId(104),
      captured_at: new Date('2026-01-01T00:02:30Z'),
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: {
        ip_routing_hash: 'e'.repeat(64),
        connection_type: 'broadband',
        latency_ms: 42,
        tls_cipher: 'TLS_AES_256_GCM_SHA384',
        vpn_detected: false,
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000006',
      transaction_id: null,
      captured_at: new Date('2026-01-01T00:04:15Z'),
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: {
        ip_routing_hash: 'f'.repeat(64),
        connection_type: 'broadband',
        latency_ms: 30,
        tls_cipher: 'TLS_AES_256_GCM_SHA384',
        vpn_detected: false,
      },
    },
  ];

  const environmentSamples = [
    {
      id: '70000000-0000-0000-0000-000000000007',
      transaction_id: syntheticId(100),
      captured_at: new Date('2025-12-28T14:22:15Z'),
      shape_type: 'client_environment',
      retention_eligible: false,
      payload: {
        screen_resolution: '1920x1080',
        battery_level: 95,
        battery_charging: true,
        os_patch_level: '2025-12-01',
        hardware_concurrency: 8,
        user_agent_category: 'desktop_browser',
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000008',
      transaction_id: syntheticId(101),
      captured_at: new Date('2025-12-29T09:15:45Z'),
      shape_type: 'client_environment',
      retention_eligible: false,
      payload: {
        screen_resolution: '390x844',
        battery_level: 78,
        battery_charging: false,
        os_patch_level: '2025-12-01',
        hardware_concurrency: 6,
        user_agent_category: 'mobile_browser',
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000009',
      transaction_id: syntheticId(102),
      captured_at: new Date('2025-12-30T18:44:05Z'),
      shape_type: 'client_environment',
      retention_eligible: false,
      payload: {
        screen_resolution: '1920x1080',
        battery_level: 60,
        battery_charging: false,
        os_patch_level: '2026-01-01',
        hardware_concurrency: 8,
        user_agent_category: 'desktop_browser',
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000010',
      transaction_id: syntheticId(103),
      captured_at: new Date('2025-12-31T22:10:10Z'),
      shape_type: 'client_environment',
      retention_eligible: false,
      payload: {
        screen_resolution: '1920x1080',
        battery_level: 45,
        battery_charging: false,
        os_patch_level: '2026-01-01',
        hardware_concurrency: 8,
        user_agent_category: 'desktop_browser',
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000011',
      transaction_id: syntheticId(104),
      captured_at: new Date('2026-01-01T00:02:35Z'),
      shape_type: 'client_environment',
      retention_eligible: false,
      payload: {
        screen_resolution: '1920x1080',
        battery_level: 38,
        battery_charging: false,
        os_patch_level: '2026-01-01',
        hardware_concurrency: 8,
        user_agent_category: 'desktop_browser',
      },
    },
    {
      id: '70000000-0000-0000-0000-000000000012',
      transaction_id: null,
      captured_at: new Date('2026-01-01T00:05:00Z'),
      shape_type: 'client_environment',
      retention_eligible: false,
      payload: {
        screen_resolution: '1920x1080',
        battery_level: 80,
        battery_charging: true,
        os_patch_level: '2026-01-01',
        hardware_concurrency: 8,
        user_agent_category: 'desktop_browser',
      },
    },
  ];

  const rawDocs = [...connectionSamples, ...environmentSamples].map((sample) => ({
    _id: sample.id,
    device_id: deviceId,
    transaction_id: sample.transaction_id,
    captured_at: sample.captured_at,
    schema_version: 1,
    shape_type: sample.shape_type,
    retention_eligible: sample.retention_eligible,
    payload: sample.payload,
  }));

  return rawDocs.map((doc) => {
    const res = validateTelemetryDoc(doc);
    if (!res.valid) {
      throw new Error(`Invalid fixture document: ${res.error}`);
    }
    return res.doc;
  });
}

export async function seedMongoTelemetry(db, deviceId = syntheticId(40)) {
  await setupMongoTelemetry(db);
  const collection = db.collection(TELEMETRY_COLLECTION);
  const fixtures = generateCanonicalTelemetryFixtures(deviceId);

  for (const doc of fixtures) {
    await collection.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }

  const count = await collection.countDocuments({ device_id: deviceId });
  console.log(`Seeded ${fixtures.length} synthetic telemetry documents for device ${deviceId} (total for device: ${count}).`);
  return { seeded: fixtures.length, deviceId, total: count };
}

if (process.argv[1]?.endsWith('mongo-telemetry-seed.mjs')) {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.MONGODB_DB_NAME || 'finsight';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    console.log(`Connected to MongoDB database: ${dbName}`);
    await seedMongoTelemetry(client.db(dbName));
    console.log('MongoDB telemetry seed completed successfully.');
  } catch {
    console.error('Failed to seed MongoDB telemetry. Check connectivity, schema and seed privileges.');
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
