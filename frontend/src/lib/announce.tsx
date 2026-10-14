// One polite aria-live region for status changes (matched, invited, errors), per the accessibility checklist.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const AnnounceContext = createContext<(message: string) => void>(() => {});

export function AnnounceProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const announce = useCallback((m: string) => {
    setMessage('');
    // re-set on the next frame so repeating the same sentence is still announced
    requestAnimationFrame(() => setMessage(m));
  }, []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="sr-only" aria-live="polite" role="status">{message}</div>
    </AnnounceContext.Provider>
  );
}

export const useAnnounce = () => useContext(AnnounceContext);
