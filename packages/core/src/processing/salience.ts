/** Half-life ~48h for score of 1.0 */
export const DECAY_CONSTANT = 0.000004;

export function updateSalienceScore(
  currentScore: number,
  signalRelevance: number,
  sourceWeight: number,
  corroboration: number,
  timeSinceLastUpdateSeconds: number
): number {
  const decayedScore = currentScore * Math.exp(-DECAY_CONSTANT * timeSinceLastUpdateSeconds);
  const boost = signalRelevance * sourceWeight * (1 + Math.log1p(corroboration));
  return Math.min(1.0, decayedScore + boost * (1 - decayedScore));
}