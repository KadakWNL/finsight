import pg from 'pg';
import argon2 from 'argon2';
import { requireTestDatabase, requireSyntheticDatabase } from './database-safety.mjs';

const OWASP_ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,       // 2 iterations
  parallelism: 1,    // 1 lane
};

export async function hashPassword(password) {
  return argon2.hash(password, OWASP_ARGON2_OPTIONS);
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

async function run() {
  const isDemo = process.argv.includes('--demo');
  const isBootstrap = process.argv.includes('--bootstrap-admin');

  if (!isDemo && !isBootstrap) {
    console.error('Usage: node scripts/provision-identities.mjs [--bootstrap-admin | --demo]');
    process.exit(1);
  }

  let connectionString;
  if (isDemo) {
    // Demo provisioning is strictly restricted to test or demo databases
    connectionString = process.env.ALLOW_TEST_DATABASE === 'true'
      ? requireTestDatabase()
      : requireSyntheticDatabase();
  } else {
    connectionString = process.env.MIGRATOR_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      console.error('MIGRATOR_DATABASE_URL or DATABASE_URL is required for bootstrap administration.');
      process.exit(1);
    }
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    // Lock against concurrent provisioning runs
    await client.query("SELECT pg_advisory_xact_lock(hashtext('finsight_identity_bootstrap'))");

    if (isBootstrap) {
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
      const displayName = process.env.BOOTSTRAP_ADMIN_NAME || 'Primary Administrator';

      if (!email || !password) {
        throw new Error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD environment variables are required.');
      }

      const normalized = normalizeEmail(email);

      // Check if an admin user already exists
      const { rows: adminRows } = await client.query(
        "SELECT user_id, email FROM public.app_user WHERE role = 'admin' LIMIT 1"
      );
      if (adminRows.length > 0) {
        console.log('An administrator account already exists. Refusing to create another or overwrite.');
        await client.query('COMMIT');
        return;
      }

      // Check if the requested email is already in use by any role
      const { rows: userRows } = await client.query(
        'SELECT user_id, email FROM public.app_user WHERE email = lower(btrim($1))',
        [normalized]
      );
      if (userRows.length > 0) {
        console.log('The requested email is already registered. Refusing to alter existing account.');
        await client.query('COMMIT');
        return;
      }

      const passwordHash = await hashPassword(password);

      await client.query(
        `INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
         VALUES (gen_random_uuid(), lower(btrim($1)), $2, $3, 'admin', true)`,
        [normalized, passwordHash, displayName]
      );

      console.log('Initial administrator account provisioned successfully.');
    }

    if (isDemo) {
      const analystPassword = process.env.DEMO_ANALYST_PASSWORD || 'synthetic-analyst-pass-1';
      const adminPassword = process.env.DEMO_ADMIN_PASSWORD || 'synthetic-admin-pass-1';

      const analystHash = await hashPassword(analystPassword);
      const adminHash = await hashPassword(adminPassword);

      const demoUsers = [
        {
          id: '20000000-0000-0000-0000-000000000001',
          email: 'analyst_a@finsight.local',
          hash: analystHash,
          name: 'Analyst Alice',
          role: 'analyst',
          active: true,
        },
        {
          id: '20000000-0000-0000-0000-000000000002',
          email: 'analyst_b@finsight.local',
          hash: analystHash,
          name: 'Analyst Bob',
          role: 'analyst',
          active: true,
        },
        {
          id: '20000000-0000-0000-0000-000000000003',
          email: 'admin@finsight.local',
          hash: adminHash,
          name: 'Admin Carol',
          role: 'admin',
          active: true,
        },
        {
          id: '20000000-0000-0000-0000-000000000004',
          email: 'inactive@finsight.local',
          hash: analystHash,
          name: 'Inactive Dave',
          role: 'analyst',
          active: false,
        },
        {
          id: '20000000-0000-0000-0000-000000000005',
          email: 'system@finsight.local',
          hash: null,
          name: 'System Service',
          role: 'system',
          active: true,
        },
      ];

      for (const u of demoUsers) {
        await client.query(
          `INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
           VALUES ($1, lower(btrim($2)), $3, $4, $5, $6)
           ON CONFLICT (email) DO NOTHING`,
          [u.id, u.email, u.hash, u.name, u.role, u.active]
        );
      }

      console.log('Demo identities provisioned successfully in isolated database.');
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  run().catch((err) => {
    console.error('Provisioning failed:', err.message);
    process.exit(1);
  });
}
