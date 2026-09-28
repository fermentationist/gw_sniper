/**
 * ShopGoodwill emits naive ISO-like timestamps (no `Z` suffix, no offset) in
 * America/Los_Angeles wall-clock time (DST-aware). Naïvely parsing them as
 * UTC yields instants 7–8 hours off, which historically caused snipes to
 * fire immediately and refresh tokens to appear expired early.
 */

const SITE_TIMEZONE = "America/Los_Angeles";

/**
 * Parse a site-emitted timestamp into an accurate {@link Date}. Strings that
 * already carry a `Z` or `±HH:MM` offset are trusted verbatim; anything else
 * is treated as {@link SITE_TIMEZONE} wall-clock time.
 */
export function parseSiteDate(raw: string): Date {
  const trimmed = raw.trim();
  if (!trimmed) return new Date(NaN);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    trimmed,
  );
  if (!m) return new Date(NaN);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? 0);
  // First approximate the instant as if the wall-clock were UTC. Then look
  // up the site TZ offset at that instant and correct. One refinement pass
  // handles DST-transition edge cases.
  const naiveAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstEstimate = naiveAsUtc - tzOffsetMinutes(new Date(naiveAsUtc)) * 60_000;
  const refinedOffset = tzOffsetMinutes(new Date(firstEstimate));
  return new Date(naiveAsUtc - refinedOffset * 60_000);
}

function tzOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SITE_TIMEZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(instant);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? 0);
  return sign * (hours * 60 + minutes);
}
