export const stylesTemplate = () => `export const stylesheet = \`
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #f6f5f3;
  --surface: #ffffff;
  --border: #e5e2dd;
  --text: #1a1a1a;
  --text-muted: #6b6b6b;
  --accent: #1a1a1a;
  --accent-hover: #333;
  --radius: 12px;
  --header-h: 60px;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 16px;
  color: var(--text);
  background: var(--bg);
}

body { min-height: 100vh; }

/* ── Layout ────────────────────────────────────────── */
.page { display: flex; flex-direction: column; min-height: 100vh; }

.header {
  height: var(--header-h);
  border-bottom: 1px solid var(--border);
  background: rgba(246, 245, 243, 0.85);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 1.5rem;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 1rem;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.01em;
}

.brand-icon { font-size: 0.85em; opacity: 0.6; }

.nav { display: flex; align-items: center; gap: 0.25rem; }

.nav-link {
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-muted);
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
}
.nav-link:hover { background: var(--border); color: var(--text); }

.main { flex: 1; padding: 3rem 1.5rem; }

.container { max-width: 1100px; margin: 0 auto; }

/* ── Typography ────────────────────────────────────── */
h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1.2; }
h2 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; }
p  { line-height: 1.65; color: var(--text-muted); }

/* ── Buttons ────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.55rem 1.1rem;
  border-radius: 8px;
  border: 1.5px solid transparent;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

.btn-secondary {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
}
.btn-secondary:hover { background: var(--bg); }

.btn-square { width: 2.5rem; height: 2.5rem; padding: 0; font-size: 1.1rem; }

.btn-full { width: 100%; }

/* ── Cards ──────────────────────────────────────────── */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
}

/* ── Hero ────────────────────────────────────────────── */
.hero {
  text-align: center;
  padding: 5rem 0 4rem;
  max-width: 640px;
  margin: 0 auto;
}

.hero-title {
  font-size: clamp(2.5rem, 6vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.04em;
  margin-bottom: 1rem;
}

.hero-subtitle {
  font-size: 1.15rem;
  margin-bottom: 2rem;
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}

.hero-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

/* ── Features ────────────────────────────────────────── */
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-top: 4rem;
}

.feature-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
}

.feature-icon { font-size: 1.5rem; display: block; margin-bottom: 0.75rem; }

.feature-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--text);
}

.feature-body { font-size: 0.9rem; }

/* ── Page header ─────────────────────────────────────── */
.page-header { margin-bottom: 2rem; }
.page-header h1 { margin-bottom: 0.5rem; }
.page-subtitle { font-size: 0.95rem; }

/* ── Counter island ──────────────────────────────────── */
.counter {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
}

.counter-value {
  text-align: center;
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

/* ── Auth pages ──────────────────────────────────────── */
.auth-page {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 3rem;
}

.auth-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 2.5rem;
  width: 100%;
  max-width: 380px;
}

.auth-header { text-align: center; margin-bottom: 1.5rem; }

.auth-tabs { display: flex; gap: .5rem; margin-bottom: 1.5rem; }

.auth-tab {
  flex: 1; padding: .5rem;
  border: none; border-radius: 8px;
  font: inherit; font-size: .875rem; font-weight: 500;
  cursor: pointer; background: var(--bg); color: var(--text-muted);
  transition: all .12s;
}
.auth-tab--active { background: var(--accent); color: white; }

.auth-error {
  color: #c53030; font-size: .8rem; margin-bottom: 1rem;
  padding: .5rem .75rem;
  background: #fff5f5; border: 1px solid #fed7d7; border-radius: 8px;
}

.auth-logo {
  font-size: 1.5rem;
  display: block;
  margin-bottom: 1rem;
}

.auth-title { font-size: 1.5rem; margin-bottom: 0.5rem; }
.auth-subtitle { font-size: 0.9rem; }

.auth-body { display: flex; flex-direction: column; gap: 0.75rem; }

.auth-footer {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 1.5rem;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

/* ── Error page ──────────────────────────────────────── */
.error-page {
  text-align: center;
  padding: 5rem 0;
}

.error-code {
  font-size: 6rem;
  font-weight: 800;
  letter-spacing: -0.05em;
  color: var(--border);
  margin-bottom: 0.5rem;
}

.error-message { margin-bottom: 2rem; }

/* ── Forms ───────────────────────────────────────────── */
.field { display: flex; flex-direction: column; gap: 0.35rem; }
.field label, .field span { font-size: 0.875rem; font-weight: 500; }

.input {
  width: 100%;
  border-radius: 8px;
  border: 1.5px solid var(--border);
  padding: 0.6rem 0.9rem;
  font: inherit;
  font-size: 0.9rem;
  background: white;
  color: var(--text);
  transition: border-color 0.12s;
}
.input:focus { outline: none; border-color: var(--accent); }

.error-hint { color: #c53030; font-size: 0.8rem; margin-top: 0.25rem; }
\`;
`;
