export const TELEMETRY_SCHEMA_VERSION = 1;
export const TELEMETRY_COLLECTION = 'device_telemetry';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_SHA256_REGEX = /^[0-9a-f]{64}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RESOLUTION_REGEX = /^\d{3,5}x\d{3,5}$/;

export function isValidUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function validateTelemetryDoc(input) {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Document must be an object' };
  }
  const raw = input;

  if (!isValidUuid(raw._id)) {
    return { valid: false, error: '_id must be a valid UUID' };
  }
  if (!isValidUuid(raw.device_id)) {
    return { valid: false, error: 'device_id must be a valid UUID' };
  }
  if (raw.transaction_id !== undefined && raw.transaction_id !== null && !isValidUuid(raw.transaction_id)) {
    return { valid: false, error: 'transaction_id must be null or a valid UUID' };
  }
  let capturedAt;
  if (raw.captured_at instanceof Date) {
    if (isNaN(raw.captured_at.getTime())) {
      return { valid: false, error: 'captured_at must be a valid Date' };
    }
    capturedAt = raw.captured_at;
  } else if (typeof raw.captured_at === 'string') {
    const parsed = new Date(raw.captured_at);
    if (isNaN(parsed.getTime())) {
      return { valid: false, error: 'captured_at must be a valid ISO date string' };
    }
    capturedAt = parsed;
  } else {
    return { valid: false, error: 'captured_at is required' };
  }

  if (raw.schema_version !== TELEMETRY_SCHEMA_VERSION) {
    return { valid: false, error: `schema_version must be ${TELEMETRY_SCHEMA_VERSION}` };
  }
  if (typeof raw.retention_eligible !== 'boolean') {
    return { valid: false, error: 'retention_eligible must be a boolean' };
  }

  if (!raw.payload || typeof raw.payload !== 'object') {
    return { valid: false, error: 'payload must be an object' };
  }
  const payload = raw.payload;

  if (raw.shape_type === 'connection_telemetry') {
    if (typeof payload.ip_routing_hash !== 'string' || !HEX_SHA256_REGEX.test(payload.ip_routing_hash)) {
      return { valid: false, error: 'payload.ip_routing_hash must be a 64-character hex string' };
    }
    const validConnections = ['cellular', 'broadband', 'vpn', 'dialup'];
    if (typeof payload.connection_type !== 'string' || !validConnections.includes(payload.connection_type)) {
      return { valid: false, error: 'payload.connection_type must be cellular, broadband, vpn, or dialup' };
    }
    if (typeof payload.latency_ms !== 'number' || !Number.isInteger(payload.latency_ms) || payload.latency_ms < 0 || payload.latency_ms > 10000) {
      return { valid: false, error: 'payload.latency_ms must be an integer between 0 and 10000' };
    }
    if (typeof payload.tls_cipher !== 'string' || payload.tls_cipher.length === 0 || payload.tls_cipher.length > 100) {
      return { valid: false, error: 'payload.tls_cipher must be a non-empty string <= 100 chars' };
    }
    if (typeof payload.vpn_detected !== 'boolean') {
      return { valid: false, error: 'payload.vpn_detected must be a boolean' };
    }

    const doc = {
      _id: raw._id,
      device_id: raw.device_id,
      transaction_id: raw.transaction_id || null,
      captured_at: capturedAt,
      schema_version: TELEMETRY_SCHEMA_VERSION,
      shape_type: 'connection_telemetry',
      retention_eligible: raw.retention_eligible,
      payload: {
        ip_routing_hash: payload.ip_routing_hash.toLowerCase(),
        connection_type: payload.connection_type,
        latency_ms: payload.latency_ms,
        tls_cipher: payload.tls_cipher,
        vpn_detected: payload.vpn_detected,
      },
    };
    return { valid: true, doc };
  }

  if (raw.shape_type === 'client_environment') {
    if (typeof payload.screen_resolution !== 'string' || !RESOLUTION_REGEX.test(payload.screen_resolution)) {
      return { valid: false, error: 'payload.screen_resolution must match format WIDTHxHEIGHT (e.g. 1920x1080)' };
    }
    if (typeof payload.battery_level !== 'number' || !Number.isInteger(payload.battery_level) || payload.battery_level < 0 || payload.battery_level > 100) {
      return { valid: false, error: 'payload.battery_level must be an integer between 0 and 100' };
    }
    if (typeof payload.battery_charging !== 'boolean') {
      return { valid: false, error: 'payload.battery_charging must be a boolean' };
    }
    if (typeof payload.os_patch_level !== 'string' || !DATE_REGEX.test(payload.os_patch_level)) {
      return { valid: false, error: 'payload.os_patch_level must be a date string YYYY-MM-DD' };
    }
    if (typeof payload.hardware_concurrency !== 'number' || !Number.isInteger(payload.hardware_concurrency) || payload.hardware_concurrency < 1 || payload.hardware_concurrency > 256) {
      return { valid: false, error: 'payload.hardware_concurrency must be an integer between 1 and 256' };
    }
    const validCategories = ['mobile_browser', 'desktop_browser', 'native_app'];
    if (typeof payload.user_agent_category !== 'string' || !validCategories.includes(payload.user_agent_category)) {
      return { valid: false, error: 'payload.user_agent_category must be mobile_browser, desktop_browser, or native_app' };
    }

    const doc = {
      _id: raw._id,
      device_id: raw.device_id,
      transaction_id: raw.transaction_id || null,
      captured_at: capturedAt,
      schema_version: TELEMETRY_SCHEMA_VERSION,
      shape_type: 'client_environment',
      retention_eligible: raw.retention_eligible,
      payload: {
        screen_resolution: payload.screen_resolution,
        battery_level: payload.battery_level,
        battery_charging: payload.battery_charging,
        os_patch_level: payload.os_patch_level,
        hardware_concurrency: payload.hardware_concurrency,
        user_agent_category: payload.user_agent_category,
      },
    };
    return { valid: true, doc };
  }

  return { valid: false, error: 'shape_type must be connection_telemetry or client_environment' };
}

export const DEVICE_TELEMETRY_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'device_id', 'captured_at', 'schema_version', 'shape_type', 'retention_eligible', 'payload'],
    properties: {
      _id: {
        bsonType: 'string',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        description: 'Primary identifier, must be a UUID string',
      },
      device_id: {
        bsonType: 'string',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        description: 'PostgreSQL device_fingerprint reference UUID',
      },
      transaction_id: {
        bsonType: ['string', 'null'],
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        description: 'Optional PostgreSQL transaction reference UUID',
      },
      captured_at: {
        bsonType: 'date',
        description: 'Observation timestamp',
      },
      schema_version: {
        bsonType: 'int',
        minimum: 1,
        maximum: 1,
        description: 'Schema version integer, currently 1',
      },
      shape_type: {
        enum: ['connection_telemetry', 'client_environment'],
        description: 'Discriminator for heterogeneous payload shapes',
      },
      retention_eligible: {
        bsonType: 'bool',
        description: 'Flag indicating eligibility for retention cleanup',
      },
      payload: {
        bsonType: 'object',
        description: 'Shape-specific telemetry payload',
      },
    },
  },
};

export const DEVICE_TELEMETRY_INDEXES = [
  {
    key: { device_id: 1, captured_at: -1 },
    name: 'idx_device_captured_at',
  },
  {
    key: { transaction_id: 1 },
    name: 'idx_transaction_id',
    sparse: true,
  },
  {
    key: { retention_eligible: 1, captured_at: 1 },
    name: 'idx_retention_eligibility',
  },
];
