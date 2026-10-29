import { describe, expect, it } from 'vitest';
import type {
  ConnectionTelemetryPayload,
  ClientEnvironmentPayload,
} from '../../src/lib/telemetry-schema';
import {
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_COLLECTION,
  validateTelemetryDoc,
  DEVICE_TELEMETRY_VALIDATOR,
  DEVICE_TELEMETRY_INDEXES,
  isValidUuid,
} from '../../scripts/telemetry-schema.mjs';
import { generateCanonicalTelemetryFixtures } from '../../scripts/mongo-telemetry-seed.mjs';

describe('Issue #17: MongoDB Telemetry Schema and Validation Unit Tests', () => {
  const validDeviceId = '20000000-0000-0000-0000-000000000040';
  const validTxnId = '20000000-0000-0000-0000-000000000100';

  it('validates shape 1: connection_telemetry documents', () => {
    const doc = {
      _id: '70000000-0000-0000-0000-000000000001',
      device_id: validDeviceId,
      transaction_id: validTxnId,
      captured_at: new Date('2026-01-01T00:01:00Z'),
      schema_version: TELEMETRY_SCHEMA_VERSION,
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: {
        ip_routing_hash: 'a'.repeat(64),
        connection_type: 'broadband',
        latency_ms: 25,
        tls_cipher: 'TLS_AES_256_GCM_SHA384',
        vpn_detected: false,
      },
    };

    const res = validateTelemetryDoc(doc);
    expect(res.valid).toBe(true);
    if (res.valid && res.doc && res.doc.shape_type === 'connection_telemetry') {
      expect(res.doc.shape_type).toBe('connection_telemetry');
      const payload = res.doc.payload as unknown as ConnectionTelemetryPayload;
      expect(payload.connection_type).toBe('broadband');
      expect(payload.latency_ms).toBe(25);
    }
  });

  it('validates shape 2: client_environment documents', () => {
    const doc = {
      _id: '70000000-0000-0000-0000-000000000002',
      device_id: validDeviceId,
      transaction_id: validTxnId,
      captured_at: '2026-01-01T00:02:00Z',
      schema_version: TELEMETRY_SCHEMA_VERSION,
      shape_type: 'client_environment',
      retention_eligible: false,
      payload: {
        screen_resolution: '1920x1080',
        battery_level: 85,
        battery_charging: true,
        os_patch_level: '2026-01-01',
        hardware_concurrency: 8,
        user_agent_category: 'desktop_browser',
      },
    };

    const res = validateTelemetryDoc(doc);
    expect(res.valid).toBe(true);
    if (res.valid && res.doc && res.doc.shape_type === 'client_environment') {
      expect(res.doc.shape_type).toBe('client_environment');
      const payload = res.doc.payload as unknown as ClientEnvironmentPayload;
      expect(payload.screen_resolution).toBe('1920x1080');
      expect(payload.battery_level).toBe(85);
      expect(res.doc.captured_at).toBeInstanceOf(Date);
    }
  });

  it('rejects invalid document identifiers and missing required properties', () => {
    expect(validateTelemetryDoc(null).valid).toBe(false);
    expect(validateTelemetryDoc({}).valid).toBe(false);
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid(validDeviceId)).toBe(true);

    // Invalid _id
    expect(validateTelemetryDoc({
      _id: 'bad-id',
      device_id: validDeviceId,
      captured_at: new Date(),
      schema_version: 1,
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: { ip_routing_hash: 'a'.repeat(64), connection_type: 'broadband', latency_ms: 10, tls_cipher: 'x', vpn_detected: false },
    }).valid).toBe(false);

    // Invalid device_id
    expect(validateTelemetryDoc({
      _id: '70000000-0000-0000-0000-000000000001',
      device_id: 'invalid-uuid',
      captured_at: new Date(),
      schema_version: 1,
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: { ip_routing_hash: 'a'.repeat(64), connection_type: 'broadband', latency_ms: 10, tls_cipher: 'x', vpn_detected: false },
    }).valid).toBe(false);

    // Invalid schema_version
    expect(validateTelemetryDoc({
      _id: '70000000-0000-0000-0000-000000000001',
      device_id: validDeviceId,
      captured_at: new Date(),
      schema_version: 99,
      shape_type: 'connection_telemetry',
      retention_eligible: false,
      payload: { ip_routing_hash: 'a'.repeat(64), connection_type: 'broadband', latency_ms: 10, tls_cipher: 'x', vpn_detected: false },
    }).valid).toBe(false);

    // Invalid shape_type
    expect(validateTelemetryDoc({
      _id: '70000000-0000-0000-0000-000000000001',
      device_id: validDeviceId,
      captured_at: new Date(),
      schema_version: 1,
      shape_type: 'unknown_shape',
      retention_eligible: false,
      payload: {},
    }).valid).toBe(false);
  });

  it('rejects invalid connection_telemetry payload fields', () => {
    const base = {
      _id: '70000000-0000-0000-0000-000000000001',
      device_id: validDeviceId,
      captured_at: new Date(),
      schema_version: 1,
      shape_type: 'connection_telemetry',
      retention_eligible: false,
    };

    // Invalid hash length
    expect(validateTelemetryDoc({
      ...base,
      payload: { ip_routing_hash: 'short', connection_type: 'broadband', latency_ms: 10, tls_cipher: 'x', vpn_detected: false },
    }).valid).toBe(false);

    // Invalid connection_type
    expect(validateTelemetryDoc({
      ...base,
      payload: { ip_routing_hash: 'a'.repeat(64), connection_type: 'satellite_5g', latency_ms: 10, tls_cipher: 'x', vpn_detected: false },
    }).valid).toBe(false);

    // Negative latency
    expect(validateTelemetryDoc({
      ...base,
      payload: { ip_routing_hash: 'a'.repeat(64), connection_type: 'broadband', latency_ms: -5, tls_cipher: 'x', vpn_detected: false },
    }).valid).toBe(false);

    // Excessive latency
    expect(validateTelemetryDoc({
      ...base,
      payload: { ip_routing_hash: 'a'.repeat(64), connection_type: 'broadband', latency_ms: 10001, tls_cipher: 'x', vpn_detected: false },
    }).valid).toBe(false);

    // Non-boolean vpn_detected
    expect(validateTelemetryDoc({
      ...base,
      payload: { ip_routing_hash: 'a'.repeat(64), connection_type: 'broadband', latency_ms: 50, tls_cipher: 'x', vpn_detected: 'true' },
    }).valid).toBe(false);
  });

  it('rejects invalid client_environment payload fields', () => {
    const base = {
      _id: '70000000-0000-0000-0000-000000000002',
      device_id: validDeviceId,
      captured_at: new Date(),
      schema_version: 1,
      shape_type: 'client_environment',
      retention_eligible: false,
    };

    // Bad resolution
    expect(validateTelemetryDoc({
      ...base,
      payload: { screen_resolution: '1920', battery_level: 50, battery_charging: false, os_patch_level: '2026-01-01', hardware_concurrency: 4, user_agent_category: 'desktop_browser' },
    }).valid).toBe(false);

    // Battery level > 100
    expect(validateTelemetryDoc({
      ...base,
      payload: { screen_resolution: '1920x1080', battery_level: 101, battery_charging: false, os_patch_level: '2026-01-01', hardware_concurrency: 4, user_agent_category: 'desktop_browser' },
    }).valid).toBe(false);

    // Bad date format
    expect(validateTelemetryDoc({
      ...base,
      payload: { screen_resolution: '1920x1080', battery_level: 50, battery_charging: false, os_patch_level: '01-01-2026', hardware_concurrency: 4, user_agent_category: 'desktop_browser' },
    }).valid).toBe(false);

    // Unknown user_agent_category
    expect(validateTelemetryDoc({
      ...base,
      payload: { screen_resolution: '1920x1080', battery_level: 50, battery_charging: false, os_patch_level: '2026-01-01', hardware_concurrency: 4, user_agent_category: 'smart_fridge' },
    }).valid).toBe(false);
  });

  it('verifies MongoDB schema validator and index declarations', () => {
    expect(TELEMETRY_COLLECTION).toBe('device_telemetry');
    expect(DEVICE_TELEMETRY_VALIDATOR.$jsonSchema).toBeDefined();
    expect(DEVICE_TELEMETRY_VALIDATOR.$jsonSchema.required).toEqual([
      '_id', 'device_id', 'captured_at', 'schema_version', 'shape_type', 'retention_eligible', 'payload',
    ]);
    expect(DEVICE_TELEMETRY_INDEXES).toHaveLength(3);
    const indexNames = DEVICE_TELEMETRY_INDEXES.map(i => i.name);
    expect(indexNames).toContain('idx_device_captured_at');
    expect(indexNames).toContain('idx_transaction_id');
    expect(indexNames).toContain('idx_retention_eligibility');
  });

  it('generates 12 deterministic canonical fixtures with both shapes', () => {
    const fixtures = generateCanonicalTelemetryFixtures(validDeviceId);
    expect(fixtures).toHaveLength(12);

    const connectionDocs = fixtures.filter(f => f && f.shape_type === 'connection_telemetry');
    const environmentDocs = fixtures.filter(f => f && f.shape_type === 'client_environment');

    expect(connectionDocs).toHaveLength(6);
    expect(environmentDocs).toHaveLength(6);

    const vpnObservations = connectionDocs.filter(d => (d?.payload as unknown as ConnectionTelemetryPayload)?.vpn_detected);
    expect(vpnObservations.length).toBeGreaterThan(0);

    for (const doc of fixtures) {
      expect(doc).toBeDefined();
      if (doc) {
        expect(doc.device_id).toBe(validDeviceId);
        expect(doc.schema_version).toBe(1);
        expect(doc.captured_at).toBeInstanceOf(Date);
      }
    }
  });
});
