// The activation engine: run the day, see who it nudged and why, what predicts a yes, and the busiest routes.
import { useCommunity } from '../api/hooks';
import { Skeleton } from '../components/ui';
import { CorridorsPanel, ModelPanel, NudgesPanel, OperatorPanel } from './Panels';

export default function EnginePage() {
  const c = useCommunity().data;
  return (
    <>
      <OperatorPanel clock={c?.clock} />
      <div className="engine-grid">
        {c ? <NudgesPanel day={c.current_day} /> : <Skeleton h={300} />}
        <div className="stack-lg">
          <ModelPanel />
          <CorridorsPanel />
        </div>
      </div>
    </>
  );
}
