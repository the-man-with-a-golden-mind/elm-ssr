export const stylesheet = `
/* Tailwind is loaded via CDN in the head, so we only need base resets or custom utilities here. */
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;700&display=swap');

:root {
  color-scheme: dark;
}

body {
  margin: 0;
  background-color: #020617; /* bg-slate-950 */
}

/* Custom chart animations */
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}
`;
