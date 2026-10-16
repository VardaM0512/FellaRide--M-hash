// Cost sharing, mirrored from the server's pricing.py (the server has the final say): a per-km rate for the
// distance a rider travels, a minimum per seat, rounded to Rs 5, and a no-profit cap so riders together never pay
// more than the trip costs to drive. The organiser sets the community's rates (GET /tenants/{id}/pricing).
export interface Rates { suggested_per_km: number; car_cost_per_km: number; min_contribution: number }

export const DEFAULT_RATES: Rates = { suggested_per_km: 3, car_cost_per_km: 9, min_contribution: 30 };   // car: petrol ~Rs 7/km + ~Rs 2/km wear

export const maxPerKm = (seats: number, r: Rates = DEFAULT_RATES) => Math.round((r.car_cost_per_km / Math.max(1, seats)) * 100) / 100;
export const defaultPerKm = (seats: number, r: Rates = DEFAULT_RATES) => Math.min(r.suggested_per_km, maxPerKm(seats, r));

export function perSeat(perKm: number, riderKm: number, routeKm: number, seats: number, r: Rates = DEFAULT_RATES): number {
  if (perKm <= 0) return 0;
  const cap = (r.car_cost_per_km * Math.max(routeKm, riderKm)) / Math.max(1, seats);
  const amount = Math.min(Math.max(perKm * riderKm, r.min_contribution), cap);
  let rounded = Math.round(amount / 5) * 5;
  if (rounded > cap) rounded -= 5;
  return Math.max(0, rounded);
}

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
export const rate = (perKm: number) => `₹${perKm % 1 ? perKm.toFixed(2).replace(/0$/, '') : perKm}/km`;
