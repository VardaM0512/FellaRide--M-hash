// Icons used only by the organiser dashboard (same 24px grid, 2px strokes as components/ui Icon).
const svg = (d: React.ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export const OrgIcon = {
  overview: svg(<><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>),
  map: svg(<><path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6z" /><path d="M9 4v14M15 6v14" /></>),
  members: svg(<><circle cx="9" cy="8" r="3.2" /><circle cx="17" cy="9.5" r="2.5" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M15 14.2c3 .1 6 1.6 6 4.8" /></>),
  rides: svg(<><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>),
  announce: svg(<><path d="M4 10v4h3l6 4V6L7 10z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" /></>),
  pricing: svg(<><path d="M7 5h10M7 9h10M9 5c4 0 5 2 5 4s-2 4-5 4H7l7 6" /></>),
  engine: svg(<><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3.5" /></>),
  expansion: svg(<><circle cx="12" cy="12" r="2.5" /><circle cx="12" cy="12" r="6" opacity="0.6" /><circle cx="12" cy="12" r="9.5" opacity="0.3" /></>),
  proof: svg(<><path d="M4 19h16" /><path d="M6 16l4-5 3 3 5-7" /><path d="M15 7h3v3" /></>),
  settings: svg(<><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>),
  more: svg(<><circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" /></>),
  copy: svg(<><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  out: svg(<><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></>),
  alert: svg(<><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.2v.1" /></>),
  spark: svg(<><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></>),
  download: svg(<><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></>),
  layers: svg(<><path d="M12 4l9 5-9 5-9-5z" /><path d="M3 14l9 5 9-5" /></>),
  target: svg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>),
};
