import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DemoPicker, SignIn, Signup, StartCommunity, Welcome } from './auth/AuthScreens';
import Dashboard from './dashboard/Dashboard';
import Expansion from './dashboard/Expansion';
import Proof from './dashboard/Proof';
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
      <Route path="dashboard" element={<RequireAdmin><Dashboard /></RequireAdmin>} />
      <Route path="dashboard/proof" element={<RequireAdmin><Proof /></RequireAdmin>} />
      <Route path="dashboard/expansion" element={<RequireAdmin><Expansion /></RequireAdmin>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
