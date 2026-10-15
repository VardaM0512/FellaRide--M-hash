// "How many seats?" for a rider booking for friends too. Same look as the driver's empty-seats stepper.
export default function SeatStepper({ value, onChange, max, label = 'Seats you need' }: {
  value: number; onChange: (n: number) => void; max: number; label?: string;
}) {
  const top = Math.max(1, max);
  return (
    <div className="field seat-stepper"><span>{label}</span>
      <div className="stepper" role="group" aria-label={label}>
        <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label="One fewer seat">−</button>
        <output aria-live="polite"><span key={value}>{value}</span></output>
        <button type="button" onClick={() => onChange(Math.min(top, value + 1))} disabled={value >= top} aria-label="One more seat">+</button>
      </div>
      <span className="hint">{value === 1 ? 'Just you.' : `You and ${value - 1} friend${value === 2 ? '' : 's'} travelling with you.`}</span>
    </div>
  );
}
