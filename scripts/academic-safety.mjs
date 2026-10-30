/**
 * Academic Mongo fixtures use a new database on a local server, never the app database.
 * @param {Record<string, string | undefined>} env
 * @param {string} runId
 */
export function academicMongoConnection(env = process.env, runId) {
  if (!env.MONGODB_URI) throw new Error('Academic verification requires a local MONGODB_URI.');
  const url = new URL(env.MONGODB_URI);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Academic verification requires a single local MongoDB server.');
  }
  if (!/^[0-9]+_[0-9a-f]{12}$/.test(runId)) throw new Error('Invalid academic run identifier.');
  return { uri: env.MONGODB_URI, database: `finsight_academic_${runId}_test` };
}
