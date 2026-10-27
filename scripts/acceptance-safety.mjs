import { requireTestDatabase } from './database-safety.mjs';

/** @param {Record<string, string | undefined>} env */
export function acceptanceConnections(env = process.env) {
  const owner = requireTestDatabase(env);
  const runtime = requireTestDatabase({ ...env, TEST_DATABASE_URL: env.ACCEPTANCE_RUNTIME_DATABASE_URL });
  const a = new URL(owner);
  const b = new URL(runtime);
  if (!a.username || a.username === b.username || b.username !== 'finsight_runtime'
      || a.hostname !== b.hostname || (a.port || '5432') !== (b.port || '5432') || a.pathname !== b.pathname) {
    throw new Error('Acceptance requires an owner and a separate finsight_runtime login on the same isolated local test database.');
  }
  return { owner, runtime };
}

export async function assertFreshAcceptanceDatabase(owner, runtime) {
  const version = Number((await owner.query('SHOW server_version_num')).rows[0].server_version_num);
  if (Math.floor(version / 10000) !== 17) throw new Error('Acceptance requires PostgreSQL 17.');
  const roles = (await owner.query(`SELECT current_user AS owner,
    (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
    (SELECT pg_get_userbyid(datdba)=current_user FROM pg_database WHERE datname=current_database()) AS owns_database`)).rows[0];
  const app = (await runtime.query(`SELECT current_user AS runtime, rolsuper, rolcreatedb, rolcreaterole,
    pg_has_role(current_user,$1,'MEMBER') AS inherits_owner FROM pg_roles WHERE rolname=current_user`, [roles.owner])).rows[0];
  if (roles.superuser || !roles.owns_database || app.rolsuper || app.rolcreatedb || app.rolcreaterole || app.inherits_owner) {
    throw new Error('Acceptance requires a non-superuser database owner and an unprivileged nonowner runtime role.');
  }
  const objects = (await owner.query(`SELECT (
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') +
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') +
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('e','d'))
    )::int AS n`)).rows[0].n;
  if (objects !== 0) throw new Error('Acceptance requires a fresh empty test database; existing objects were left unchanged.');
  const membership = (await owner.query(`SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='finsight_auth_probe')
    THEN pg_has_role(current_user,'finsight_auth_probe','MEMBER') ELSE false END AS probe,
    pg_has_role(current_user,'finsight_runtime','MEMBER') AS runtime_member`)).rows[0];
  if (!membership.probe || !membership.runtime_member) throw new Error('Provision the test probe and runtime role memberships before acceptance.');
  return { postgresVersion: version, ownerRole: roles.owner, runtimeRole: app.runtime, runtimeIsNonowner: true };
}
