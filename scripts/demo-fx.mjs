import { createHash } from "node:crypto";

export const FX_ORIGIN = "https://api.frankfurter.dev";
export function isoDay(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw new Error("Expected a valid ISO date.");
  return value;
}
export function shiftDay(day, n) {
  return new Date(Date.parse(isoDay(day) + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function exactRate(value) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,11})(\.\d{1,8})?$/.test(value)
  )
    throw new Error("Invalid reference-rate precision.");
  const [whole, fraction = ""] = value.split(".");
  if (BigInt(whole + fraction.padEnd(8, "0")) <= 0n)
    throw new Error("Reference rates must be positive.");
  return whole + "." + fraction.padEnd(8, "0");
}
export function snapshotHash(snapshot) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: snapshot.provider,
        base: snapshot.base,
        quote: snapshot.quote,
        observations: snapshot.observations,
      }),
    )
    .digest("hex");
}
export function validateSnapshot(snapshot) {
  if (
    !snapshot ||
    snapshot.format !== 1 ||
    snapshot.provider !== "ecb" ||
    snapshot.base !== "USD" ||
    snapshot.quote !== "INR" ||
    !Array.isArray(snapshot.observations) ||
    !snapshot.observations.length ||
    snapshot.observations.length > 400
  )
    throw new Error("Invalid FX snapshot.");
  let previous = "";
  for (const row of snapshot.observations) {
    if (isoDay(row.date) <= previous || exactRate(row.rate) !== row.rate)
      throw new Error(
        "FX observations must have unique ordered dates and exact rates.",
      );
    previous = row.date;
  }
  const url = new URL(snapshot.source_url);
  if (
    url.origin !== FX_ORIGIN ||
    url.pathname !== "/v2/providers/ecb/rates.csv" ||
    snapshot.sha256 !== snapshotHash(snapshot)
  )
    throw new Error("FX snapshot source or checksum mismatch.");
  return snapshot;
}
export function parseReferenceCsv(
  text,
  sourceUrl,
  fetchedAt = new Date().toISOString(),
) {
  if (typeof text !== "string" || text.length > 100000)
    throw new Error("FX response exceeds the expected size.");
  const lines = text.trim().split(/\r?\n/);
  if (
    lines.shift() !== "date,base,quote,rate" ||
    !lines.length ||
    lines.length > 400
  )
    throw new Error("Unexpected FX CSV format.");
  const observations = lines.map((line) => {
    const cells = line.split(",");
    if (cells.length !== 4 || cells[1] !== "USD" || cells[2] !== "INR")
      throw new Error("Unexpected FX currency pair.");
    return { date: isoDay(cells[0]), rate: exactRate(cells[3]) };
  });
  const snapshot = {
    format: 1,
    provider: "ecb",
    base: "USD",
    quote: "INR",
    source_url: sourceUrl,
    fetched_at: fetchedAt,
    observations,
  };
  snapshot.sha256 = snapshotHash(snapshot);
  return validateSnapshot(snapshot);
}
export async function fetchReferenceSnapshot(
  start,
  days,
  fetcher = globalThis.fetch,
) {
  isoDay(start);
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new Error("FX date range must be 1-365 days.");
  const end = shiftDay(start, days - 1);
  if (end >= new Date().toISOString().slice(0, 10))
    throw new Error("Use completed historical dates.");
  const url = new URL("/v2/providers/ecb/rates.csv", FX_ORIGIN);
  for (const [key, value] of Object.entries({
    base: "USD",
    quotes: "INR",
    from: shiftDay(start, -10),
    to: shiftDay(end, -1),
  }))
    url.searchParams.set(key, value);
  const response = await fetcher(url, {
    signal: globalThis.AbortSignal.timeout(20000),
    redirect: "error",
    headers: { Accept: "text/csv" },
  });
  if (!response.ok)
    throw new Error(
      "Reference-rate provider is unavailable; retry or use a saved snapshot.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing FX response body.");
  const decoder = new globalThis.TextDecoder();
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > 100000)
        throw new Error("FX response exceeds the expected size.");
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
  }
  const snapshot = parseReferenceCsv(text, url.href);
  for (let n = 0; n < days; n++) rateForDay(snapshot, shiftDay(start, n));
  return snapshot;
}
export function rateForDay(snapshot, day) {
  isoDay(day);
  const observation = snapshot.observations.findLast((row) => row.date < day);
  if (
    !observation ||
    Date.parse(day) - Date.parse(observation.date) > 7 * 86400000
  )
    throw new Error("Missing recent prior-business-day FX observation.");
  return observation;
}
