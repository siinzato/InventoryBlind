// Physical Count Engine — location range resolution over REAL, already-
// registered product locations.
//
// products.location is free text with NO enforced structure — it's whatever
// column the company's own spreadsheet import used (see productImportUtils.ts's
// LOCAL field aliases: local/location/localizacao/endereco/posicao/rua/vao).
// There is no reliable common pattern to parse across companies, so this
// deliberately does NOT try to interpret the string's internal structure
// (an earlier version assumed a "ZONA-RUA-POSIÇÃO" shape from the ticket's
// illustrative example, which caused real products to be reported as "não
// encontrado" whenever the real data didn't match that assumed shape).
//
// Instead: the operator picks the range boundaries from the list of location
// values that ALREADY exist for real, registered products, sorted naturally,
// and every product whose location falls between those two REAL values
// (inclusive) is included. A product can never fail to be found due to a
// format mismatch, because the boundaries themselves are always real values.

export function sortLocationsNaturally(locations: string[]): string[] {
  return [...locations].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Distinct, non-empty `location` values across the given products, sorted naturally. */
export function listDistinctLocations(items: Array<{ location: string | null }>): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const loc = item.location?.trim();
    if (loc) set.add(loc);
  }
  return sortLocationsNaturally([...set]);
}

/** No structure to derive — the raw, official value IS the display value. */
export function describeLocation(location: string | null | undefined): string {
  return location?.trim() || '—';
}

/**
 * Every product whose location falls within [locationFrom, locationTo]
 * (inclusive, order-independent) according to its position in `sortedLocations`
 * — the full list of real locations this range is being chosen from. Returns
 * [] if either boundary isn't actually in that list (should not happen when
 * the UI only offers real values to pick from).
 */
export function resolveProductsInLocationRange<T extends { location: string | null }>(
  products: T[],
  sortedLocations: string[],
  locationFrom: string,
  locationTo: string
): T[] {
  const fromIdx = sortedLocations.indexOf(locationFrom);
  const toIdx = sortedLocations.indexOf(locationTo);
  if (fromIdx === -1 || toIdx === -1) return [];

  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  const rangeSet = new Set(sortedLocations.slice(lo, hi + 1));

  return products.filter(p => p.location != null && rangeSet.has(p.location.trim()));
}
