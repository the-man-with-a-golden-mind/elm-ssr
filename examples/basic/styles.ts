export const stylesheet = `
:root {
  color-scheme: light;
  --bg: #f4efe7;
  --panel: rgba(255, 251, 244, 0.9);
  --ink: #1d1b19;
  --muted: #5a554f;
  --accent: #155848;
  --accent-soft: #dcebe5;
  --line: rgba(29, 27, 25, 0.08);
  --shadow: 0 18px 60px rgba(21, 88, 72, 0.14);
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  background:
    radial-gradient(circle at top left, rgba(21, 88, 72, 0.12), transparent 34%),
    linear-gradient(180deg, #fbf8f2 0%, var(--bg) 100%);
  color: var(--ink);
  font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
}

a {
  color: inherit;
}

.shell {
  width: min(1120px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 24px 0 64px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 0 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-badge {
  border-radius: 999px;
  padding: 6px 10px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.brand-title {
  margin: 0;
  font-size: 1.1rem;
}

.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.nav-link,
.button-link,
.link {
  text-decoration: none;
  font-weight: 700;
}

.nav-link,
.button-link {
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.72);
  padding: 10px 14px;
}

.button-link.primary,
.counter-button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.content {
  display: grid;
  gap: 24px;
}

.panel {
  border: 1px solid var(--line);
  border-radius: 26px;
  background: var(--panel);
  padding: 24px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
}

.hero {
  padding: 32px;
}

.hero h1,
.counter-panel h1 {
  margin: 0 0 12px;
  font-size: clamp(2.7rem, 7vw, 5rem);
  line-height: 0.94;
  letter-spacing: -0.045em;
}

.eyebrow {
  display: inline-block;
  margin-bottom: 12px;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.panel p,
.list {
  color: var(--muted);
  font-size: 1.04rem;
  line-height: 1.7;
}

.hero-actions,
.counter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 18px;
}

.counter-value {
  margin-top: 24px;
  font-size: clamp(4rem, 14vw, 7rem);
  line-height: 1;
  letter-spacing: -0.06em;
}

.counter-button {
  min-width: 88px;
  border-radius: 18px;
  border: 1px solid var(--line);
  background: white;
  color: var(--ink);
  padding: 14px 18px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.counter-code {
  display: block;
  margin-top: 20px;
  color: var(--accent);
  white-space: pre-wrap;
}

.list {
  margin: 0;
  padding-left: 18px;
}

@media (max-width: 720px) {
  .shell {
    width: min(100vw - 20px, 1120px);
    padding-top: 16px;
  }

  .topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .hero,
  .panel {
    padding: 20px;
  }
}
`;
