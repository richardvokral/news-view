// Period helpers shared by the /insights tabs.
//
// Client-side on purpose: every tab turns a week count into the `from`/`to`
// week boundaries its API expects, and the Czech plural rules were being
// re-derived in four places.

/** Monday of the week `weeks` back from the current one, as YYYY-MM-DD. */
export function weekOffset(weeks: number): string {
  const d = new Date();
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift - weeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * "Poslední týden" / "Poslední 3 týdny" / "Posledních 8 týdnů" — Czech needs
 * three forms, and "Posledních 2 týdnů" in a dropdown looks like a bug.
 */
export function weeksLabel(weeks: number): string {
  if (weeks === 1) return "Poslední týden";
  if (weeks <= 4) return `Poslední ${weeks} týdny`;
  return `Posledních ${weeks} týdnů`;
}

/** Merge period choices into one ascending, de-duplicated list. */
export function periodOptions(...values: number[]): number[] {
  return [...new Set(values.filter((n) => Number.isFinite(n) && n > 0))].sort(
    (a, b) => a - b
  );
}
