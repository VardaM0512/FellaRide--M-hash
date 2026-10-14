// Who is signed in. Every screen reads the member and community from here; the API client
// attaches the token. Stored on this device so the app opens straight to Today, like a phone app.
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { setAuthToken } from '../api/client';
import type { Session } from '../api/types';

const KEY = 'fellaride.session';

interface SessionCtx {
  session: Session | null;
  signIn: (s: Session) => void;
  signOut: () => void;
}

const Ctx = createContext<SessionCtx>({ session: null, signIn: () => {}, signOut: () => {} });

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    // drop expired tokens without a round trip
    const exp = JSON.parse(atob(s.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp as number;
    if (!exp || exp * 1000 < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(() => {
    const s = load();
    setAuthToken(s?.token ?? null);
    return s;
  });

  const signIn = useCallback((s: Session) => {
    setAuthToken(s.token);
    qc.clear();
    setSession(s);
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: stay signed in for this tab */ }
  }, [qc]);

  const signOut = useCallback(() => {
    setAuthToken(null);
    qc.clear();
    setSession(null);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, [qc]);

  useEffect(() => {
    const onExpired = () => signOut();
    window.addEventListener('fellaride:signed-out', onExpired);
    return () => window.removeEventListener('fellaride:signed-out', onExpired);
  }, [signOut]);

  return <Ctx.Provider value={{ session, signIn, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

/** The signed-in member and community. Only used inside screens that require a member session. */
export function useMe() {
  const { session } = useSession();
  return {
    tenantId: session?.tenant.id ?? 0,
    memberId: session?.user.member_id ?? null,
    isAdmin: session?.user.role === 'admin',
    tenant: session?.tenant,
  };
}
