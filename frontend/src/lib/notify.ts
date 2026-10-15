// Phone / desktop notifications. Shown through the service worker when possible (needed on Android),
// otherwise with the plain Notification API. Browsers only allow this on https or localhost.
export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export async function showSystemNotification(title: string, body: string, url: string, tag: string) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png', tag, data: { url } });
    new Notification(title, { body, icon: '/icon-192.png', tag });
  } catch { /* blocked: the in-app banner still shows */ }
}
