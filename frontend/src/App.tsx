import { Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from './dashboard/Dashboard';
import Proof from './dashboard/Proof';
import MemberLayout from './member/MemberLayout';
import Invite from './member/Invite';
import Me from './member/Me';
import Ride from './member/Ride';
import Today from './member/Today';

export default function App() {
  return (
    <Routes>
      <Route element={<MemberLayout />}>
        <Route index element={<Today />} />
        <Route path="ride" element={<Ride />} />
        <Route path="invite" element={<Invite />} />
        <Route path="me" element={<Me />} />
      </Route>
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="dashboard/proof" element={<Proof />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
