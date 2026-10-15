import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AnnounceProvider } from './lib/announce';
import { registerServiceWorker } from './lib/notify';
import { PrefsProvider, usePrefs } from './lib/prefs';
import { SessionProvider } from './lib/session';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: (count, err) => count < 1 && !(err as { status?: number }).status, refetchOnWindowFocus: true },
  },
});

registerServiceWorker();

/** Framer Motion follows the in-app "Reduce motion" switch as well as the system setting. */
function Motion({ children }: { children: ReactNode }) {
  const { motionReduced } = usePrefs();
  return <MotionConfig reducedMotion={motionReduced ? 'always' : 'user'}>{children}</MotionConfig>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <AnnounceProvider>
            <PrefsProvider>
              <Motion><App /></Motion>
            </PrefsProvider>
          </AnnounceProvider>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
