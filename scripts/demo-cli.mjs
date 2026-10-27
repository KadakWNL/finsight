import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import pg from "pg";
import { requireSyntheticDatabase } from "./database-safety.mjs";
import { fetchReferenceSnapshot, validateSnapshot } from "./demo-fx.mjs";
import { buildDemoDataset, demoOptions } from "./demo-dataset.mjs";
import { importDemoDataset } from "./demo-import.mjs";

try {
  const command = process.argv[2],
    args = {};
  for (const arg of process.argv.slice(3)) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(args, match[1]))
      throw new Error("Use unique --name=value arguments.");
    args[match[1]] = match[2];
  }
  const allowed =
    command === "fx"
      ? ["start", "days", "out"]
      : command === "import"
        ? [
            "seed",
            "start",
            "days",
            "transactions",
            "customers",
            "merchants",
            "snapshot",
            "manifest",
          ]
        : [];
  if (!allowed.length || Object.keys(args).some((k) => !allowed.includes(k)))
    throw new Error(
      "Usage: demo-cli.mjs fx --out=path or import --snapshot=path --manifest=path, with optional bounded dataset parameters.",
    );
  const options = demoOptions(
    Object.fromEntries(
      Object.entries(args)
        .filter(([k]) =>
          [
            "seed",
            "start",
            "days",
            "transactions",
            "customers",
            "merchants",
          ].includes(k),
        )
        .map(([k, v]) => [k, ["seed", "start"].includes(k) ? v : Number(v)]),
    ),
  );
  if (command === "fx") {
    if (!args.out) throw new Error("Provide --out for the saved FX snapshot.");
    const snapshot = await fetchReferenceSnapshot(options.start, options.days);
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(snapshot, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(
      `Saved ${snapshot.observations.length} daily ECB observations; checksum ${snapshot.sha256}.`,
    );
  } else {
    const databaseUrl = requireSyntheticDatabase();
    if (!args.snapshot || !args.manifest)
      throw new Error("Provide --snapshot and --manifest paths.");
    const raw = await readFile(args.snapshot, "utf8");
    if (raw.length > 150000)
      throw new Error("FX snapshot exceeds the size limit.");
    const dataset = buildDemoDataset(
        options,
        validateSnapshot(JSON.parse(raw)),
      ),
      manifest = JSON.stringify(dataset.manifest, null, 2) + "\n";
    await mkdir(dirname(args.manifest), { recursive: true });
    try {
      await writeFile(args.manifest, manifest, { flag: "wx" });
    } catch (error) {
      if (
        error.code !== "EEXIST" ||
        (await readFile(args.manifest, "utf8")) !== manifest
      )
        throw new Error(
          "Manifest path exists with different content; choose another path.",
          { cause: error },
        );
    }
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const role = (
        await client.query(
          "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0];
      if (role.rolsuper) throw new Error("Use a non-superuser demo migrator.");
      const counts = await importDemoDataset(client, dataset);
      console.log(
        `Verified synthetic demo import: ${counts.transaction} transactions, ${counts.customer} customers, ${counts.merchant} merchants. Existing facts and immutable signals retained.`,
      );
    } finally {
      await client.end();
    }
  }
} catch (error) {
  console.error(
    error.message?.startsWith("Demo import conflicts")
      ? error.message
      : "Demo command failed. Check parameters, local snapshot/manifest paths, database opt-in and provider availability; credentials omitted.",
  );
  process.exitCode = 1;
}
