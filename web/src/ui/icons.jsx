// Thin line icons for tools and layer kinds, drawn in the app itself.
const S = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const Icon = ({ path, children, ...rest }) => (
  <svg {...S} {...rest}>{path ? <path d={path} /> : children}</svg>
);

export const icons = {
  select: (p) => <Icon {...p}><path d="M5 3l14 8-6 2-2 6z" /></Icon>,
  text: (p) => <Icon {...p}><path d="M5 6V4h14v2M12 4v16M9 20h6" /></Icon>,
  rect: (p) => <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="2" /></Icon>,
  ellipse: (p) => <Icon {...p}><circle cx="12" cy="12" r="8" /></Icon>,
  line: (p) => <Icon {...p}><path d="M5 19L19 5" /></Icon>,
  group: (p) => <Icon {...p}><rect x="3" y="3" width="11" height="11" rx="1" /><rect x="10" y="10" width="11" height="11" rx="1" /></Icon>,
  guide: (p) => <Icon {...p}><path d="M4 4v16M20 4v16M8 12h8" /></Icon>,
  undo: (p) => <Icon {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></Icon>,
  redo: (p) => <Icon {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></Icon>,
  image: (p) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 15l5-4 4 3 3-2 6 5" /></Icon>,
  library: (p) => <Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Icon>,
  star: ({ fill, ...p }) => <Icon {...p}><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill={fill || 'none'} /></Icon>,
  copy: (p) => <Icon {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></Icon>,
  file: (p) => <Icon {...p}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></Icon>,
  download: (p) => <Icon {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Icon>,
  trash: (p) => <Icon {...p}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></Icon>,
};
