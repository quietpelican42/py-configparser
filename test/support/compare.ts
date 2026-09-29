/** Path of the first difference between two JSON values, or null when equal. */
export function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return `${path}: expected ${short(a)} got ${short(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: expected ${short(a)} got ${short(b)}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}: expected ${short(a)} got ${short(b)}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(oa), ...Object.keys(ob)]);
  for (const k of keys) {
    if (!(k in oa) || !(k in ob)) return `${path}.${k}: key only in ${k in oa ? 'expected' : 'actual'}`;
    const d = firstDiff(oa[k], ob[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

function short(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length > 300 ? s.slice(0, 300) + '...' : s;
}
