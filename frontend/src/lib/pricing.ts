// Cost sharing, mirrored from the server's pricing.py (the server has the final say): a per-km rate for the
// distance a rider travels, a Rs 30 minimum, rounded to Rs 5, and a no-profit cap so riders together never pay
// more than the trip costs to drive.
export const SUGGESTED_PER_KM = 3;
export const MIN_CONTRIBUTION = 30;
export const CAR_COST_PER_KM = 9;   // petrol ~Rs 7/km + ~Rs 2/km wear

export const maxPerKm = (seats: number) => Math.round((CAR_COST_PER_KM / Math.max(1, seats)) * 100) / 100;
export const defaultPerKm = (seats: number) => Math.min(SUGGESTED_PER_KM, maxPerKm(seats));

export function perSeat(perKm: number, riderKm: number, routeKm: number, seats: number): number {
  if (perKm <= 0) return 0;
  const cap = (CAR_COST_PER_KM * Math.max(routeKm, riderKm)) / Math.max(1, seats);
  const amount = Math.min(Math.max(perKm * riderKm, MIN_CONTRIBUTION), cap);
  let r = Math.round(amount / 5) * 5;
  if (r > cap) r -= 5;
  return Math.max(0, r);
}

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
export const rate = (perKm: number) => `₹${perKm % 1 ? perKm.toFixed(2).replace(/0$/, '') : perKm}/km`;
