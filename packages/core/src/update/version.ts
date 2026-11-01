/** Toglie il prefisso: "v26.2.0" → "26.2.0"; "26.2.0" resta invariato. */
export function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v/i, '');
}

/** Confronta due versioni `X.Y.Z` numericamente: > 0 se `a` è più recente di `b`. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    stripVersionPrefix(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);
  return Array.from({ length }, (_, index) => (left[index] ?? 0) - (right[index] ?? 0)).find((diff) => diff !== 0) ?? 0;
}
