export function normalizeBearing(bearingDeg: number): number {
  const bearing = bearingDeg % 360;
  return bearing < 0 ? bearing + 360 : bearing;
}

export function shortestTurnToBearing(currentHeadingDeg: number, targetBearingDeg: number): number {
  let turn = normalizeBearing(targetBearingDeg - currentHeadingDeg);
  if (turn > 180) turn -= 360;
  return turn;
}
