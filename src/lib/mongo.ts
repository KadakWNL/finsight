import 'server-only';
import { MongoClient, type Db } from 'mongodb';

let clientInstance: MongoClient | null = null;
let clientPromise: Promise<MongoClient | null> | null = null;

export function getMongoUri(): string | null {
  return process.env.MONGODB_URI || null;
}

export function getMongoDbName(): string {
  return process.env.MONGODB_DB_NAME || 'finsight';
}

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

export async function getMongoClient(): Promise<MongoClient | null> {
  const uri = getMongoUri();
  if (!uri) {
    return null;
  }

  if (clientInstance) {
    return clientInstance;
  }

  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const client = new MongoClient(uri, {
          serverSelectionTimeoutMS: 2000,
          connectTimeoutMS: 2000,
          socketTimeoutMS: 5000,
          maxPoolSize: 10,
        });
        await client.connect();
        clientInstance = client;
        return client;
      } catch {
        clientPromise = null;
        clientInstance = null;
        return null;
      }
    })();
  }

  return clientPromise;
}

export async function getMongoDb(): Promise<Db | null> {
  const client = await getMongoClient();
  if (!client) {
    return null;
  }
  return client.db(getMongoDbName());
}

export async function closeMongoClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.close();
    clientInstance = null;
    clientPromise = null;
  }
}
