// Who the member app is acting as. Today it's the demo "Viewing as" picker; when login lands,
// replace this provider's internals with the logged-in member and no screen has to change.
import { createContext, useContext, useState, type ReactNode } from 'react';

interface Identity { memberId: number | null; setMemberId: (id: number) => void }

const IdentityContext = createContext<Identity>({ memberId: null, setMemberId: () => {} });
const STORAGE_KEY = 'fellaride.viewingAs';

function readStored(): number | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [memberId, setId] = useState<number | null>(readStored);
  const setMemberId = (id: number) => {
    setId(id);
    try { localStorage.setItem(STORAGE_KEY, String(id)); } catch { /* storage blocked: keep in memory */ }
  };
  return <IdentityContext.Provider value={{ memberId, setMemberId }}>{children}</IdentityContext.Provider>;
}

export const useIdentity = () => useContext(IdentityContext);
