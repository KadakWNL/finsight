import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { MongoClient, type Document } from 'mongodb';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { seedFinancial, syntheticId } from '../../scripts/financial-seed.mjs';
import { seedMongoTelemetry } from '../../scripts/mongo-telemetry-seed.mjs';
import { TELEMETRY_COLLECTION } from '../../scripts/telemetry-schema.mjs';

vi.mock('server-only', () => ({}));

import { createSession, SESSION_COOKIE_NAME } from '../../src/server/session';
import { encodeSessionToken } from '../../src/server/authentication';
import { getPool } from '../../src/server/db';
import { closeMongoClient } from '../../src/lib/mongo';
import { GET as transactionDetailRoute } from '../../src/app/api/v1/transactions/[id]/route';
import { getTransactionTelemetry, fetchDeviceTelemetryByDeviceId } from '../../src/server/telemetry';

describe('Issue #17: MongoDB Telemetry Integration and API Tests', () => {
  let pgClient: pg.Client;
  let mongoClient: MongoClient;
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const mongoDbName = (process.env.MONGODB_TEST_DB_NAME || process.env.MONGODB_DB_NAME || '').endsWith('_test')
    ? (process.env.MONGODB_TEST_DB_NAME || process.env.MONGODB_DB_NAME)!
    : 'finsight_telemetry_test';

  if (!mongoDbName.endsWith('_test')) {
    throw new Error('MongoDB test database name must end in _test');
  }

  let initialMongoUri: string | undefined;
  let initialMongoDbName: string | undefined;

  const analystId = '98000000-0000-0000-0000-000000000001';
  const adminId = '98000000-0000-0000-0000-000000000002';
  let analystCookie: string;
  let adminCookie: string;

  const txn100Id = syntheticId(100); // 20000000-0000-0000-0000-000000000100 (occurred 00:00:00Z)
  const txn105Id = syntheticId(105); // 20000000-0000-0000-0000-000000000105 (occurred 00:05:00Z)
  const canonicalDeviceId = syntheticId(40); // 20000000-0000-0000-0000-000000000040

  const emptyTxnId = '20000000-0000-0000-0000-000000000999';
  const emptyDeviceId = '20000000-0000-0000-0000-000000000998';

  beforeAll(async () => {
    initialMongoUri = process.env.MONGODB_URI;
    initialMongoDbName = process.env.MONGODB_DB_NAME;

    process.env.MONGODB_URI = mongoUri;
    process.env.MONGODB_DB_NAME = mongoDbName;

    // 1. Setup PostgreSQL test database
    pgClient = new pg.Client({ connectionString: requireTestDatabase() });
    await pgClient.connect();
    await applyMigrations(pgClient, new URL('../../migrations/', import.meta.url));
    await seedFinancial(pgClient);

    // Insert analyst and admin
    await pgClient.query(`
      INSERT INTO public.app_user (user_id, email, password_hash, display_name, role)
      VALUES
        ($1, 'telemetry_analyst@synthetic.invalid', 'test-only', 'Telemetry Analyst', 'analyst'),
        ($2, 'telemetry_admin@synthetic.invalid', 'test-only', 'Telemetry Admin', 'admin')
      ON CONFLICT (user_id) DO NOTHING;
    `, [analystId, adminId]);

    const analystSession = await createSession(analystId, pgClient);
    analystCookie = `${SESSION_COOKIE_NAME}=${await encodeSessionToken(analystId, analystSession.sessionId)}`;

    const adminSession = await createSession(adminId, pgClient);
    adminCookie = `${SESSION_COOKIE_NAME}=${await encodeSessionToken(adminId, adminSession.sessionId)}`;

    // Insert an isolated transaction/device in PostgreSQL with no Mongo telemetry
    await pgClient.query(`
      INSERT INTO public.device_fingerprint (device_id, device_hash, os_family, first_seen_at)
      VALUES ($1, repeat('9', 64), 'synthetic-empty', '2026-01-01T00:00:00Z')
      ON CONFLICT DO NOTHING;
    `, [emptyDeviceId]);

    await pgClient.query(`
      INSERT INTO public.transaction (
        transaction_id, account_id, merchant_id, device_id, amount, currency_code,
        exchange_rate, direction, txn_type, status, occurred_at, merchant_country_code, description
      )
      SELECT $1, account_id, merchant_id, $2, 150.00, 'INR', 1.0, direction, txn_type, status, occurred_at, merchant_country_code, 'Empty telemetry test txn'
      FROM public.transaction WHERE transaction_id = $3
      ON CONFLICT DO NOTHING;
    `, [emptyTxnId, emptyDeviceId, txn100Id]);

    // 2. Setup MongoDB test database and seed fixtures
    mongoClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 3000 });
    await mongoClient.connect();
    const mongoDb = mongoClient.db(mongoDbName);
    await mongoDb.collection(TELEMETRY_COLLECTION).drop().catch(() => {});
    await seedMongoTelemetry(mongoDb, canonicalDeviceId);
  });

  afterAll(async () => {
    if (mongoClient) {
      await mongoClient.db(mongoDbName).dropDatabase().catch(() => {});
      await mongoClient.close().catch(() => {});
    }
    await closeMongoClient().catch(() => {});
    if (initialMongoUri !== undefined) {
      process.env.MONGODB_URI = initialMongoUri;
    } else {
      delete process.env.MONGODB_URI;
    }
    if (initialMongoDbName !== undefined) {
      process.env.MONGODB_DB_NAME = initialMongoDbName;
    } else {
      delete process.env.MONGODB_DB_NAME;
    }
    if (pgClient) {
      await pgClient.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;').catch(() => {});
      await pgClient.end().catch(() => {});
      await getPool().end().catch(() => {});
    }
  });

  function makeRequest(path: string, cookie?: string) {
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    return new Request(`http://localhost${path}`, { method: 'GET', headers });
  }

  it('VS-TELEMETRY-01: returns available bounded telemetry summary for canonical transaction and respects time bounding', async () => {
    // For transaction 105 (occurred at 00:05:00Z), all 12 fixtures are prior or equal to occurrence
    const req105 = makeRequest(`/api/v1/transactions/${txn105Id}`, analystCookie);
    const res105 = await transactionDetailRoute(req105, { params: Promise.resolve({ id: txn105Id }) });

    expect(res105.status).toBe(200);
    const body105 = await res105.json();
    const data105 = body105.data;

    expect(data105.transaction_id).toBe(txn105Id);
    expect(data105.device_id).toBe(canonicalDeviceId);
    expect(data105.telemetry).toBeDefined();
    expect(data105.telemetry.status).toBe('available');

    const summary105 = data105.telemetry.summary;
    expect(summary105.total_observations).toBe(12);
    expect(summary105.time_window.earliest).toBeDefined();
    expect(summary105.time_window.latest).toBeDefined();

    // Connection shape aggregation verification
    expect(summary105.connection_summary.count).toBe(6);
    expect(summary105.connection_summary.connection_types).toContain('broadband');
    expect(summary105.connection_summary.connection_types).toContain('cellular');
    expect(summary105.connection_summary.connection_types).toContain('vpn');
    expect(summary105.connection_summary.vpn_count).toBe(1);
    expect(summary105.connection_summary.avg_latency_ms).toBeGreaterThan(0);
    expect(summary105.connection_summary.min_latency_ms).toBe(28);
    expect(summary105.connection_summary.max_latency_ms).toBe(145);

    // Client environment shape aggregation verification
    expect(summary105.environment_summary.count).toBe(6);
    expect(summary105.environment_summary.os_patch_levels).toContain('2025-12-01');
    expect(summary105.environment_summary.os_patch_levels).toContain('2026-01-01');
    expect(summary105.environment_summary.user_agent_categories).toContain('desktop_browser');
    expect(summary105.environment_summary.user_agent_categories).toContain('mobile_browser');

    // Recent samples limited to 5
    expect(summary105.recent_samples).toHaveLength(5);
    for (const sample of summary105.recent_samples) {
      expect(['connection_telemetry', 'client_environment']).toContain(sample.shape_type);
      expect(sample.captured_at).toBeDefined();
    }

    // For transaction 100 (occurred at 00:00:00Z), exactly 8 observations prior to 00:00:00Z are returned (no future observations leaked)
    const req100 = makeRequest(`/api/v1/transactions/${txn100Id}`, analystCookie);
    const res100 = await transactionDetailRoute(req100, { params: Promise.resolve({ id: txn100Id }) });
    expect(res100.status).toBe(200);
    const data100 = (await res100.json()).data;
    expect(data100.telemetry.status).toBe('available');
    expect(data100.telemetry.summary.total_observations).toBe(8);
  });

  it('VS-TELEMETRY-02: returns truthful no_data state for transaction device without telemetry', async () => {
    const req = makeRequest(`/api/v1/transactions/${emptyTxnId}`, analystCookie);
    const res = await transactionDetailRoute(req, { params: Promise.resolve({ id: emptyTxnId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data;

    expect(data.transaction_id).toBe(emptyTxnId);
    expect(data.device_id).toBe(emptyDeviceId);
    expect(data.telemetry).toEqual({
      status: 'no_data',
      message: 'No telemetry recorded for this device.',
    });

    // Core transaction and financial facts remain intact
    expect(data.amount).toBe('150.00');
    expect(data.currency_code).toBe('INR');
    expect(data.status).toBe('posted');
  });

  it('VS-TELEMETRY-03: rejects unknown or invalid transactions before MongoDB read', async () => {
    const unknownId = '99999999-9999-9999-9999-999999999999';
    const req = makeRequest(`/api/v1/transactions/${unknownId}`, analystCookie);
    const res = await transactionDetailRoute(req, { params: Promise.resolve({ id: unknownId }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('not_found');

    // Direct server-side reference check rejects unknown transaction
    const direct = await getTransactionTelemetry(pgClient, unknownId);
    expect(direct).toEqual({
      status: 'unavailable',
      message: 'Referenced transaction does not exist in PostgreSQL.',
    });

    // Malformed transaction UUID rejected as 400
    const badReq = makeRequest('/api/v1/transactions/not-a-valid-uuid', analystCookie);
    const badRes = await transactionDetailRoute(badReq, { params: Promise.resolve({ id: 'not-a-valid-uuid' }) });
    expect(badRes.status).toBe(400);
  });

  it('VS-TELEMETRY-04: enforces authentication and role-based permissions', async () => {
    // Unauthenticated
    const unauthReq = makeRequest(`/api/v1/transactions/${txn100Id}`);
    const unauthRes = await transactionDetailRoute(unauthReq, { params: Promise.resolve({ id: txn100Id }) });
    expect(unauthRes.status).toBe(401);

    // Admin permitted
    const adminReq = makeRequest(`/api/v1/transactions/${txn100Id}`, adminCookie);
    const adminRes = await transactionDetailRoute(adminReq, { params: Promise.resolve({ id: txn100Id }) });
    expect(adminRes.status).toBe(200);
  });

  it('VS-TELEMETRY-05: preserves masked projections and excludes raw sensitive metadata', async () => {
    const req = makeRequest(`/api/v1/transactions/${txn100Id}`, analystCookie);
    const res = await transactionDetailRoute(req, { params: Promise.resolve({ id: txn100Id }) });
    const data = (await res.json()).data;

    // Masked customer and account
    expect(data.account.number_masked).toMatch(/^\*\*\*\*/);
    expect(data.customer.display_label).toMatch(/^Customer \d{4}$/);
    expect(data.payment_method?.last4).toBeDefined();

    // Telemetry summary only contains allowlisted aggregation fields
    const telemetry = data.telemetry;
    expect(telemetry.summary.connection_summary).not.toHaveProperty('ip_address');
    expect(telemetry.summary.connection_summary).not.toHaveProperty('credentials');
    expect(telemetry.summary.environment_summary).not.toHaveProperty('raw_headers');
  });

  it('VS-TELEMETRY-06: gracefully degrades to unavailable when MongoDB is offline without breaking PostgreSQL', async () => {
    const originalUri = process.env.MONGODB_URI;
    try {
      // Force MongoDB offline by pointing to an inactive port and closing active client
      await closeMongoClient();
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27999';

      const req = makeRequest(`/api/v1/transactions/${txn100Id}`, analystCookie);
      const res = await transactionDetailRoute(req, { params: Promise.resolve({ id: txn100Id }) });

      // Core transaction MUST still succeed with HTTP 200
      expect(res.status).toBe(200);
      const data = (await res.json()).data;

      expect(data.transaction_id).toBe(txn100Id);
      expect(data.amount).toBeDefined();
      expect(data.signals).toBeDefined();
      expect(data.telemetry).toEqual({
        status: 'unavailable',
        message: 'Telemetry unavailable (offline/unreachable); core transaction and risk evidence retained.',
      });
    } finally {
      await closeMongoClient();
      if (originalUri !== undefined) {
        process.env.MONGODB_URI = originalUri;
      } else {
        delete process.env.MONGODB_URI;
      }
    }
  });

  it('VS-TELEMETRY-07: verifies strict MongoDB schema validator and collection indexes', async () => {
    const db = mongoClient.db(mongoDbName);
    const collection = db.collection(TELEMETRY_COLLECTION);

    // Verify indexes exist
    const indexes = await collection.indexes();
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_device_captured_at');
    expect(indexNames).toContain('idx_transaction_id');
    expect(indexNames).toContain('idx_retention_eligibility');

    // Attempting to insert an invalid document directly into MongoDB is rejected by collection validator
    const invalidDoc = {
      _id: randomUUID(),
      device_id: 'not-a-uuid',
      captured_at: new Date(),
      schema_version: 1,
      shape_type: 'unknown_shape',
      retention_eligible: false,
      payload: {},
    };

    await expect(collection.insertOne(invalidDoc as unknown as Document)).rejects.toThrow();

    // Read path never mutates collection count
    const countBefore = await collection.countDocuments();
    await fetchDeviceTelemetryByDeviceId(canonicalDeviceId);
    const countAfter = await collection.countDocuments();
    expect(countAfter).toBe(countBefore);
  });
});
