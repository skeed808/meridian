export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalised Levenshtein similarity ratio in [0, 1]. */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeEntityName(a);
  const right = normalizeEntityName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= left.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= right.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[left.length][right.length];
  const maxLen = Math.max(left.length, right.length);
  return 1 - distance / maxLen;
}