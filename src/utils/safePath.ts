/**
 * IDs are put into paths with encodeURIComponent, which leaves '.' and '..'
 * alone, and URLs resolve them: '/charges/..' would become '/'. Refuse any dot
 * segment, encoded or not (review L4).
 */
export function assertSafePath(path: string): void {
  const segments = path.split('?')[0].split('/');
  for (const segment of segments) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      /* keep the raw segment */
    }
    if (decoded === '.' || decoded === '..') {
      throw new Error(`Refused a request path with a "${decoded}" segment. IDs can't be "." or "..".`);
    }
  }
}

/** The same check for one path parameter value (v3 clients fill path parameters for us). */
export function assertSafePathParam(value: unknown): void {
  assertSafePath(`/${String(value)}`);
}
