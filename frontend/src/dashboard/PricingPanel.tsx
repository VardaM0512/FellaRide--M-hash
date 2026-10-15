// Organiser: the community's cost-sharing rates. Changes apply to rides posted from then on.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { request } from '../api/client';
import { useRates, type CommunityPricing } from '../api/trips';
import { ErrorNote, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { ago } from '../lib/format';
import { defaultPerKm, maxPerKm, perSeat, rate, rupees, type Rates } from '../lib/pricing';
import { useMe } from '../lib/session';

const asForm = (r: Rates) => ({ suggested: String(r.suggested_per_km), car: String(r.car_cost_per_km), min: String(r.min_contribution) });

export default function PricingPanel() {
  const { tenantId } = useMe();
  const qc = useQueryClient();
  const announce = useAnnounce();
  const q = useRates();
  const [form, setForm] = useState<{ suggested: string; car: string; min: string } | null>(null);
  useEffect(() => { if (q.data && !form) setForm(asForm(q.data)); }, [q.data, form]);

  const save = useMutation({
    mutationFn: (r: Rates) => request<CommunityPricing>(`/tenants/${tenantId}/pricing`, { method: 'PUT', body: r }),
    onSuccess: (d) => { qc.setQueryData(['pricing', tenantId], d); setForm(asForm(d)); announce('Rates saved. New rides use them.'); },
  });

  const d = q.data;
  if (!d || !form) {
    return (
      <section className="panel" aria-labelledby="price-h">
        <h2 id="price-h">Ride pricing</h2>
        {q.error ? <ErrorNote error={q.error} onRetry={() => q.refetch()} /> : <Skeleton h={160} />}
      </section>
    );
  }

  const r: Rates = { suggested_per_km: Number(form.suggested), car_cost_per_km: Number(form.car), min_contribution: Number(form.min) };
  const problem = !(r.car_cost_per_km > 0 && r.car_cost_per_km <= 100) ? 'The car’s running cost must be between ₹0 and ₹100 a km.'
    : !(r.suggested_per_km > 0) ? 'The suggested rate must be more than ₹0 a km.'
    : r.suggested_per_km > r.car_cost_per_km ? 'The suggested rate can’t be more than the car’s running cost: riders would be paying for a profit.'
    : !(Number.isInteger(r.min_contribution) && r.min_contribution >= 0 && r.min_contribution <= 1000) ? 'The minimum must be a whole number of rupees, 0 to 1,000.'
    : null;
  const unchanged = r.suggested_per_km === d.suggested_per_km && r.car_cost_per_km === d.car_cost_per_km && r.min_contribution === d.min_contribution;
  const isDefault = (['suggested_per_km', 'car_cost_per_km', 'min_contribution'] as const).every((k) => r[k] === d.defaults[k]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  function submit(e: FormEvent) { e.preventDefault(); if (!problem && !unchanged) save.mutate(r); }

  return (
    <section className="panel" aria-labelledby="price-h">
      <h2 id="price-h">Ride pricing</h2>
      <div className="dash-row" style={{ gap: 20 }}>
        <form className="stack" onSubmit={submit}>
          <p className="small muted">Riders chip in for the distance they travel. Changes apply to rides posted from now on; rides already posted keep their price.</p>
          <label className="field">Suggested rate (₹ per km a rider travels)
            <input type="number" inputMode="decimal" min={0.5} max={100} step={0.5} value={form.suggested} onChange={set('suggested')} required />
            <span className="hint">What a driver’s “Suggested” option charges. Drivers can still pick Free or Half.</span>
          </label>
          <label className="field">Car running cost (₹ per km)
            <input type="number" inputMode="decimal" min={1} max={100} step={0.5} value={form.car} onChange={set('car')} required />
            <span className="hint">Fuel and wear. All riders together never pay more than this, so drivers can’t make a profit.</span>
          </label>
          <label className="field">Minimum per seat (₹)
            <input type="number" inputMode="numeric" min={0} max={1000} step={5} value={form.min} onChange={set('min')} required />
            <span className="hint">For short rides, unless it would go over the car’s cost.</span>
          </label>
          {problem && <p className="note note-error" role="alert">{problem}</p>}
          <ErrorNote error={save.error} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!!problem || unchanged || save.isPending}>{save.isPending ? 'Saving…' : 'Save rates'}</button>
            <button type="button" className="btn btn-quiet" disabled={isDefault} onClick={() => setForm(asForm(d.defaults))}>Use the defaults</button>
          </div>
        </form>

        <div className="stack">
          <h3 style={{ fontSize: 16 }}>What riders would pay</h3>
          {problem ? <p className="small muted">Fix the rates to see a preview.</p> : (
            <ul className="list-plain">
              {[1, 2, 3, 4].map((seats) => {
                const perKm = defaultPerKm(seats, r);
                return (
                  <li key={seats}>
                    <p><strong>{seats} seat{seats === 1 ? '' : 's'}</strong> · {rate(perKm)} (most allowed {rate(maxPerKm(seats, r))})</p>
                    <p className="small">5 km: {rupees(perSeat(perKm, 5, 20, seats, r))} · 10 km: {rupees(perSeat(perKm, 10, 20, seats, r))} · 20 km: {rupees(perSeat(perKm, 20, 20, seats, r))}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="stack">
          <h3 style={{ fontSize: 16 }}>Changes</h3>
          {!d.history?.length ? <p className="small muted">Still on the defaults: {rate(d.defaults.suggested_per_km)}, car {rate(d.defaults.car_cost_per_km)}, minimum {rupees(d.defaults.min_contribution)}.</p> : (
            <ul className="list-plain">
              {d.history.map((h) => (
                <li key={h.changed_at}>
                  <p>{rate(h.suggested_per_km)} · car {rate(h.car_cost_per_km)} · minimum {rupees(h.min_contribution)}</p>
                  <p className="small muted">{ago(h.changed_at)}{h.changed_by ? ` by ${h.changed_by}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
