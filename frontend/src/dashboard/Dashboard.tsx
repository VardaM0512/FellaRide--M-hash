import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useClusters, useCommunity, useGraph, useMembers } from '../api/hooks';
import { DemoTag, ErrorNote, Skeleton } from '../components/ui';
import { useSession } from '../lib/session';
import CommunityMap from './CommunityMap';
import MemberAppPanel from './MemberAppPanel';
import { CorridorsPanel, FunnelPanel, MemberSheet, ModelPanel, Numbers, NudgesPanel, OperatorPanel } from './Panels';

export default function Dashboard() {
  const community = useCommunity();
  const members = useMembers();
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const graph = useGraph();
  const clusters = useClusters();
  const [selected, setSelected] = useState<number | null>(null);

  if (community.error) return <div className="dash"><ErrorNote error={community.error} onRetry={() => community.refetch()} /></div>;
  const c = community.data;
  const mapError = members.error || graph.error;

  return (
    <div className="dash">
      <header className="dash-head">
        <h1 style={{ fontSize: 'var(--fs-h2)' }}>{c ? c.name : <Skeleton w={260} h={30} />}</h1>
        {c && <DemoTag show={c.synthetic} />}
        {c && <span className="muted">Day {c.current_day} of the community</span>}
        <span className="spacer" />
        {session?.tenant.join_code && (
          <span className="chip" style={{ padding: '6px 12px' }}>Join code <span className="join-code" style={{ fontSize: 16 }}>{session.tenant.join_code}</span></span>
        )}
        <Link to="/dashboard/proof" className="btn btn-small">Proof</Link>
        <button className="btn btn-quiet btn-small" onClick={() => { signOut(); navigate('/welcome'); }}>Sign out</button>
      </header>

      <div className="dash-grid">
        {c && members.data && graph.data
          ? <CommunityMap community={c} members={members.data} graph={graph.data} corridors={clusters.data || []} onSelect={setSelected} />
          : <section className="panel">{mapError ? <ErrorNote error={mapError} onRetry={() => { members.refetch(); graph.refetch(); }} /> : <Skeleton h={560} />}</section>}
        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <Numbers />
          <FunnelPanel />
        </div>
      </div>

      <MemberAppPanel />

      <OperatorPanel />

      <div className="dash-row">
        {c ? <NudgesPanel day={c.current_day} /> : <Skeleton h={200} />}
        <CorridorsPanel />
        <ModelPanel />
      </div>

      {selected !== null && <MemberSheet id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
