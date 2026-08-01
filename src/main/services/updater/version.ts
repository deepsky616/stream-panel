function numericParts(version: string): number[] {
  const core = version.trim().replace(/^v/i, '').split('-', 1)[0];
  if (!/^\d+(?:\.\d+)*$/.test(core)) return [];
  return core.split('.').map((part) => Number(part));
}

export function compareVersions(left: string, right: string): number {
  const leftParts = numericParts(left);
  const rightParts = numericParts(right);
  if (!leftParts.length || !rightParts.length) return 0;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function normalizeVersion(version: string): string | null {
  const parts = numericParts(version);
  return parts.length ? parts.join('.') : null;
}
