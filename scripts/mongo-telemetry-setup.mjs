import { MongoClient } from 'mongodb';
import {
  TELEMETRY_COLLECTION,
  DEVICE_TELEMETRY_VALIDATOR,
  DEVICE_TELEMETRY_INDEXES,
} from './telemetry-schema.mjs';

export async function setupMongoTelemetry(db) {
  const collections = await db.listCollections({ name: TELEMETRY_COLLECTION }).toArray();
  if (collections.length === 0) {
    await db.createCollection(TELEMETRY_COLLECTION, {
      validator: DEVICE_TELEMETRY_VALIDATOR,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    console.log(`Created collection "${TELEMETRY_COLLECTION}" with strict schema validator.`);
  } else {
    await db.command({
      collMod: TELEMETRY_COLLECTION,
      validator: DEVICE_TELEMETRY_VALIDATOR,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    console.log(`Updated schema validator on existing collection "${TELEMETRY_COLLECTION}".`);
  }

  const collection = db.collection(TELEMETRY_COLLECTION);
  for (const indexDef of DEVICE_TELEMETRY_INDEXES) {
    const { key, ...options } = indexDef;
    await collection.createIndex(key, options);
  }
  const createdIndexes = await collection.indexes();
  console.log(`Configured indexes on "${TELEMETRY_COLLECTION}":`, createdIndexes.map(i => i.name).join(', '));
  return { collection: TELEMETRY_COLLECTION, indexes: createdIndexes };
}

if (process.argv[1]?.endsWith('mongo-telemetry-setup.mjs')) {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.MONGODB_DB_NAME || 'finsight';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    console.log(`Connected to MongoDB at ${uri}, database: ${dbName}`);
    await setupMongoTelemetry(client.db(dbName));
    console.log('MongoDB telemetry collection setup completed successfully.');
  } catch (error) {
    console.error('Failed to setup MongoDB telemetry:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}
