import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DemoPicker, SignIn, Signup, StartCommunity, Welcome } from './auth/AuthScreens';
import Announce from './dashboard/Announce';
import CommunitySettings from './dashboard/CommunitySettings';
import EnginePage from './dashboard/EnginePage';
import Expansion from './dashboard/Expansion';
import ImpactPage from './dashboard/ImpactPage';
import LiveMap from './dashboard/LiveMap';
import LiveRides from './dashboard/LiveRides';
import Members from './dashboard/Members';
import More from './dashboard/More';
import OrgLayout from './dashboard/OrgLayout';
import Overview from './dashboard/Overview';
import PricingPanel from './dashboard/PricingPanel';
import Proof from './dashboard/Proof';
import RidesSafety from './dashboard/RidesSafety';
import { useSession } from './lib/session';
import AlertsScreen from './member/AlertsScreen';
import AppLayout from './member/AppLayout';
import Community from './member/Community';
import Find from './member/Find';
import Home from './member/Home';
import Invite from './member/Invite';
import Offer from './member/Offer';
import Settings from './member/Settings';
import TripScreen from './member/TripScreen';
import You, { ProfileSetup } from './member/You';

function RequireMember({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const loc = useLocation();
  if (!session) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  if (session.user.role === 'admin') return <Navigate to="/dashboard" replace />;
  // demo accounts start without a gender or mobile: ask once
  if (!session.profile) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/signin" replace />;
  if (session.user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SignedOutOnly({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (session) return <Navigate to={session.user.role === 'admin' ? '/dashboard' : '/'} replace />;
  return <>{children}</>;
}

function NeedsProfile({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/welcome" replace />;
  if (session.profile || session.user.role === 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="welcome" element={<SignedOutOnly><Welcome /></SignedOutOnly>} />
      <Route path="signin" element={<SignedOutOnly><SignIn /></SignedOutOnly>} />
      <Route path="signup" element={<SignedOutOnly><Signup /></SignedOutOnly>} />
      <Route path="join" element={<Navigate to="/signup" replace />} />
      <Route path="demo" element={<SignedOutOnly><DemoPicker /></SignedOutOnly>} />
      <Route path="start" element={<SignedOutOnly><StartCommunity /></SignedOutOnly>} />
      <Route path="setup" element={<NeedsProfile><ProfileSetup /></NeedsProfile>} />
      <Route element={<RequireMember><AppLayout /></RequireMember>}>
        <Route index element={<Home />} />
        <Route path="offer" element={<Offer />} />
        <Route path="find" element={<Find />} />
        <Route path="trip/:id" element={<TripScreen />} />
        <Route path="alerts" element={<AlertsScreen />} />
        <Route path="invite" element={<Invite />} />
        <Route path="me" element={<You />} />
        <Route path="community" element={<Community />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="dashboard" element={<RequireAdmin><OrgLayout /></RequireAdmin>}>
        <Route index element={<Overview />} />
        <Route path="map" element={<LiveMap />} />
        <Route path="members" element={<Members />} />
        <Route path="impact" element={<ImpactPage />} />
        <Route path="live" element={<LiveRides />} />
        <Route path="rides" element={<RidesSafety />} />
        <Route path="announce" element={<Announce />} />
        <Route path="pricing" element={<PricingPanel />} />
        <Route path="engine" element={<EnginePage />} />
        <Route path="expansion" element={<Expansion />} />
        <Route path="proof" element={<Proof />} />
        <Route path="settings" element={<CommunitySettings />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
