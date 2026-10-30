import { expect, test } from 'vitest';
import { academicMongoConnection } from '../../scripts/academic-safety.mjs';

test('academic Mongo fixtures require a local server and never reuse the configured application database', () => {
  const env = { MONGODB_URI: 'mongodb://127.0.0.1:27017/finsight_demo', MONGODB_DB_NAME: 'finsight_demo' };
  expect(academicMongoConnection(env, '20261030_123456abcdef').database).toBe('finsight_academic_20261030_123456abcdef_test');
  for (const uri of ['mongodb://remote.example:27017', 'mongodb+srv://localhost', 'https://localhost', 'mongodb://localhost,remote.example']) {
    expect(() => academicMongoConnection({ MONGODB_URI: uri }, '20261030_123456abcdef')).toThrow();
  }
  expect(() => academicMongoConnection({}, '20261030_123456abcdef')).toThrow();
  expect(() => academicMongoConnection(env, '../finsight_demo')).toThrow();
});
