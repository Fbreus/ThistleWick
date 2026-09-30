/** Radius at which a placed light makes gloom beetles turn away. */
export function beetleWardRadius(kind: string, campRadius = 9): number {
  if (kind === 'lantern') return 14;
  if (kind === 'camp') return campRadius;
  if (kind === 'torch') return campRadius * 0.45;
  return 0;
}
