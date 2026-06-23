import type { EffectRunner } from "./effects";

export const instrumentEffects = (baseRunner: EffectRunner): EffectRunner => {
  return async (effect, context) => {
    const start = performance.now();
    try {
      const result = await baseRunner(effect, context);
      const durationMs = performance.now() - start;
      if (context.debugLogs) {
        context.debugLogs.push({
          kind: effect.kind,
          payload: effect.payload,
          ok: result.ok,
          value: result.value,
          error: result.error,
          durationMs
        });
      }
      return result;
    } catch (err: unknown) {
      const durationMs = performance.now() - start;
      if (context.debugLogs) {
        context.debugLogs.push({
          kind: effect.kind,
          payload: effect.payload,
          ok: false,
          error: String(err),
          durationMs
        });
      }
      throw err;
    }
  };
};

export const injectDebugger = (html: string, data: unknown): string => {
  const scriptContent = `
(function() {
  const data = ${JSON.stringify(data)};
  
  // 1. Create stylesheet
  const style = document.createElement('style');
  style.textContent = \`
    #elm-ssr-debug-panel {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100vw;
      height: 350px;
      background: rgba(17, 24, 39, 0.95);
      backdrop-filter: blur(12px);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      color: #e5e7eb;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      z-index: 999999;
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      box-shadow: 0 -10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    #elm-ssr-debug-panel.open {
      transform: translateY(0);
    }
    #elm-ssr-debug-toggle {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(79, 70, 229, 0.9);
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: 9999px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85em;
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
      z-index: 999998;
      backdrop-filter: blur(4px);
      transition: all 0.2s;
    }
    #elm-ssr-debug-toggle:hover {
      background: rgba(79, 70, 229, 1);
      transform: scale(1.05);
    }
    .debug-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 16px;
      background: rgba(0, 0, 0, 0.2);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .debug-title {
      font-weight: 700;
      color: #818cf8;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.9em;
    }
    .debug-tabs {
      display: flex;
      gap: 4px;
    }
    .debug-tab {
      background: transparent;
      border: none;
      color: #9ca3af;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 0.85em;
      font-weight: 500;
      border-radius: 4px;
      transition: all 0.15s;
    }
    .debug-tab:hover {
      color: #f3f4f6;
      background: rgba(255, 255, 255, 0.05);
    }
    .debug-tab.active {
      color: white;
      background: rgba(79, 70, 229, 0.2);
      border: 1px solid rgba(79, 70, 229, 0.4);
    }
    .debug-close {
      background: transparent;
      border: none;
      color: #9ca3af;
      cursor: pointer;
      font-size: 1.2em;
    }
    .debug-close:hover {
      color: white;
    }
    .debug-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      font-size: 0.85em;
    }
    .debug-pane {
      display: none;
    }
    .debug-pane.active {
      display: block;
    }
    .overview-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .overview-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      padding: 12px;
    }
    .overview-label {
      color: #9ca3af;
      font-size: 0.8em;
      margin-bottom: 4px;
    }
    .overview-val {
      font-size: 1.1em;
      font-weight: 600;
    }
    .status-ok { color: #34d399; }
    .status-error { color: #f87171; }
    .debug-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .debug-item {
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 6px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background 0.15s;
    }
    .debug-item:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .debug-item-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .debug-badge {
      font-size: 0.75em;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }
    .badge-primary { background: rgba(79, 70, 229, 0.2); color: #a5b4fc; border: 1px solid rgba(79, 70, 229, 0.4); }
    .badge-success { background: rgba(52, 211, 153, 0.2); color: #a7f3d0; border: 1px solid rgba(52, 211, 153, 0.4); }
    .badge-warn { background: rgba(251, 191, 36, 0.2); color: #fde68a; border: 1px solid rgba(251, 191, 36, 0.4); }
    .debug-code {
      background: rgba(0, 0, 0, 0.3);
      padding: 10px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #a7f3d0;
      margin: 4px 0;
      border: 1px solid rgba(255, 255, 255, 0.03);
    }
    #elm-ssr-debug-highlight {
      position: absolute;
      background: rgba(139, 92, 246, 0.15);
      border: 2px dashed rgba(139, 92, 246, 0.8);
      pointer-events: none;
      z-index: 999997;
      display: none;
      box-sizing: border-box;
      box-shadow: 0 0 12px rgba(139, 92, 246, 0.3);
      border-radius: 4px;
      transition: all 0.15s ease-out;
    }
  \`;
  document.head.appendChild(style);

  // 2. Create Highlight div
  const highlight = document.createElement('div');
  highlight.id = 'elm-ssr-debug-highlight';
  document.body.appendChild(highlight);

  // 3. Create Toggle Button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'elm-ssr-debug-toggle';
  toggleBtn.innerHTML = '⚡ Debug';
  document.body.appendChild(toggleBtn);
  
  // 4. Create Panel DOM
  const panel = document.createElement('div');
  panel.id = 'elm-ssr-debug-panel';
  
  const isSqlKind = (kind) => ['query', 'queryOne', 'execute'].includes(kind);
  
  const generateEffectItemHtml = (eff) => {
    const isSql = isSqlKind(eff.kind);
    const sqlSnippet = isSql ? \`<pre class="debug-code">\${eff.payload.sql}</pre>\` : '';
    const paramsSnippet = isSql && eff.payload.params && eff.payload.params.length > 0 ? 
      \`<div><strong>Params:</strong> \${JSON.stringify(eff.payload.params)}</div>\` : '';
    const outcome = eff.ok ? '<span class="status-ok">SUCCESS</span>' : '<span class="status-error">FAILED</span>';
    const detailError = eff.error ? \`<div class="status-error">\${eff.error}</div>\` : '';
    return \`
      <li class="debug-item">
        <div class="debug-item-meta" style="flex: 1;">
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="debug-badge badge-primary">\${eff.kind}</span>
            \${outcome}
            <span style="color: #9ca3af; font-size: 0.85em;">\${eff.durationMs.toFixed(1)}ms</span>
          </div>
          \${sqlSnippet}
          \${paramsSnippet}
          \${detailError}
        </div>
      </li>
    \`;
  };

  const getDbHtml = (effects) => {
    const dbEffects = (effects || []).filter(eff => isSqlKind(eff.kind));
    if (dbEffects.length === 0) {
      return '<div style="color: #9ca3af; text-align: center; padding: 20px;">No SQL database queries executed for this request.</div>';
    }
    return \`<ul class="debug-list">\${dbEffects.map(generateEffectItemHtml).join('')}</ul>\`;
  };

  const getEffectsHtml = (effects) => {
    const nonDbEffects = (effects || []).filter(eff => !isSqlKind(eff.kind));
    if (nonDbEffects.length === 0) {
      return '<div style="color: #9ca3af; text-align: center; padding: 20px;">No other server-side effects executed for this request.</div>';
    }
    return \`<ul class="debug-list">\${nonDbEffects.map(generateEffectItemHtml).join('')}</ul>\`;
  };

  panel.innerHTML = \`
    <div class="debug-header">
      <div class="debug-title">
        <span>⚡</span> elm-ssr DevTools
      </div>
      <div class="debug-tabs">
        <button class="debug-tab active" data-tab="overview">Overview</button>
        <button class="debug-tab" data-tab="islands">Islands</button>
        <button class="debug-tab" data-tab="database">Database</button>
        <button class="debug-tab" data-tab="effects">Effects</button>
        <button class="debug-tab" data-tab="session">Session</button>
        <button class="debug-tab" data-tab="bridges">Bridges</button>
      </div>
      <button class="debug-close">&times;</button>
    </div>
    
    <div class="debug-content">
      <!-- OVERVIEW TAB -->
      <div class="debug-pane active" id="pane-overview">
        <div class="overview-grid">
          <div class="overview-card">
            <div class="overview-label">Request Method & Path</div>
            <div class="overview-val">\${data.method} \${new URL(data.url).pathname}</div>
          </div>
          <div class="overview-card">
            <div class="overview-label">HTTP Status</div>
            <div class="overview-val \${data.status < 400 ? 'status-ok' : 'status-error'}">\${data.status}</div>
          </div>
          <div class="overview-card">
            <div class="overview-label">Server Render Time</div>
            <div class="overview-val">\${data.durationMs.toFixed(1)} ms</div>
          </div>
          <div class="overview-card">
            <div class="overview-label">Database & Effects</div>
            <div class="overview-val">\${(data.effects || []).length} calls</div>
          </div>
        </div>
      </div>
      
      <!-- ISLANDS TAB -->
      <div class="debug-pane" id="pane-islands">
        <ul class="debug-list" id="debug-islands-list">
          <li style="color: #9ca3af; text-align: center; padding: 20px;">Scanning page for active islands...</li>
        </ul>
      </div>
      
      <!-- DATABASE TAB -->
      <div class="debug-pane" id="pane-database">
        \${getDbHtml(data.effects)}
      </div>
      
      <!-- EFFECTS TAB -->
      <div class="debug-pane" id="pane-effects">
        \${getEffectsHtml(data.effects)}
      </div>
      
      <!-- SESSION TAB -->
      <div class="debug-pane" id="pane-session">
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <strong>Session Data:</strong>
            <pre class="debug-code" style="color: #818cf8;">\${JSON.stringify(data.session, null, 2) || 'null'}</pre>
          </div>
        </div>
      </div>
      
      <!-- BRIDGES TAB -->
      <div class="debug-pane" id="pane-bridges">
        <div style="margin-bottom: 8px; color: #9ca3af; font-size: 0.9em;">Live broadcast event listener. Send messages to see updates:</div>
        <ul class="debug-list" id="debug-bridges-log">
          <li style="color: #9ca3af; text-align: center; padding: 12px;">Listening for 'elm-ssr-broadcast' events...</li>
        </ul>
      </div>
    </div>
  \`;
  document.body.appendChild(panel);

  toggleBtn.addEventListener('click', () => {
    panel.classList.add('open');
    toggleBtn.style.display = 'none';
  });
  
  panel.querySelector('.debug-close').addEventListener('click', () => {
    panel.classList.remove('open');
    toggleBtn.style.display = 'block';
  });

  const tabs = panel.querySelectorAll('.debug-tab');
  const panes = panel.querySelectorAll('.debug-pane');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      panel.querySelector('#pane-' + tab.getAttribute('data-tab')).classList.add('active');
    });
  });

  const highlightElement = (el, label) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    highlight.style.top = (rect.top + scrollY) + 'px';
    highlight.style.left = (rect.left + scrollX) + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
    highlight.style.display = 'block';
  };

  const removeHighlight = () => {
    highlight.style.display = 'none';
  };

  const islandMutations = new Map();
  const islandActiveStates = new Map();
  const activeObservers = new Map();
  
  const setupMutationObservers = () => {
    for (const obs of activeObservers.values()) {
      obs.disconnect();
    }
    activeObservers.clear();
    
    const markers = Array.from(document.getElementsByTagName('elm-ssr-island'));
    markers.forEach(marker => {
      if (!islandMutations.has(marker)) {
        islandMutations.set(marker, { count: 0, lastUpdate: null });
      }
      
      const observer = new MutationObserver(() => {
        const stats = islandMutations.get(marker);
        stats.count += 1;
        stats.lastUpdate = new Date();
        
        const activeTab = panel.querySelector('.debug-tab.active')?.getAttribute('data-tab');
        if (activeTab === 'islands') {
          scanIslands();
        }
      });
      
      observer.observe(marker, { childList: true, subtree: true, characterData: true, attributes: true });
      activeObservers.set(marker, observer);
    });
  };

  const findMarkerByOrigin = (origin) => {
    if (!origin) return null;
    const markers = Array.from(document.getElementsByTagName('elm-ssr-island'));
    return markers.find(marker => {
      const name = marker.getAttribute('data-elmssr-island');
      const id = marker.getAttribute('data-elmssr-id');
      return name === origin.name && (id === origin.id || (!id && !origin.id));
    });
  };

  const scanIslands = () => {
    const list = panel.querySelector('#debug-islands-list');
    const markers = Array.from(document.getElementsByTagName('elm-ssr-island'));
    
    if (markers.length === 0) {
      list.innerHTML = '<li style="color: #9ca3af; text-align: center; padding: 20px;">No interactive islands found on this page.</li>';
      return;
    }
    
    list.innerHTML = '';
    markers.forEach((marker, index) => {
      const name = marker.getAttribute('data-elmssr-island') || 'Unknown';
      const props = marker.getAttribute('data-elmssr-props') || '{}';
      const isBooted = marker.getAttribute('data-elmssr-booted') === 'true';
      const id = marker.getAttribute('data-elmssr-id') || 'none';
      
      const stats = islandMutations.get(marker) || { count: 0, lastUpdate: null };
      const lastUpdateStr = stats.lastUpdate 
        ? \`Last active DOM mutation: \${stats.lastUpdate.toLocaleTimeString()}\`
        : 'No client state changes recorded';
      
      const activeState = islandActiveStates.get(marker);
      const domTextPreview = marker.textContent.trim().replace(/\\s+/g, ' ');
      
      let stateSnippet = '';
      if (activeState) {
        stateSnippet = \`
          <div style="font-size: 0.85em; margin-top: 6px; color: #a5b4fc;"><strong>Active Model State:</strong></div>
          <pre class="debug-code" style="font-size: 0.85em; max-height: 120px; overflow-y: auto; color: #818cf8;">\${JSON.stringify(activeState, null, 2)}</pre>
        \`;
      } else if (domTextPreview) {
        stateSnippet = \`
          <div style="font-size: 0.85em; margin-top: 6px; color: #9ca3af;"><strong>DOM Text Preview (Live):</strong></div>
          <div class="debug-code" style="font-size: 0.85em; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">\${domTextPreview}</div>
        \`;
      }
      
      const li = document.createElement('li');
      li.className = 'debug-item';
      li.style.cursor = 'pointer';
      li.innerHTML = \`
        <div class="debug-item-meta" style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #c084fc;">\${name}</strong>
            <span class="debug-badge \${isBooted ? 'badge-success' : 'badge-warn'}">
              \${isBooted ? 'BOOTED' : 'INITIALIZING'}
            </span>
          </div>
          <div style="font-size: 0.8em; margin-top: 4px; color: #9ca3af; display: flex; justify-content: space-between;">
            <span><strong>ID:</strong> \${id}</span>
            <span style="color: #34d399;"><strong>DOM Mutations:</strong> \${stats.count}</span>
          </div>
          <div style="font-size: 0.75em; color: #9ca3af; margin-top: 2px;">\${lastUpdateStr}</div>
          \${stateSnippet}
          <div style="font-size: 0.8em; margin-top: 6px; color: #e5e7eb;"><strong>Initial Props:</strong></div>
          <pre class="debug-code" style="font-size: 0.85em; max-height: 80px; overflow-y: auto;">\${JSON.stringify(JSON.parse(props), null, 2)}</pre>
        </div>
      \`;
      
      li.addEventListener('mouseenter', () => highlightElement(marker, name));
      li.addEventListener('mouseleave', removeHighlight);
      list.appendChild(li);
    });
  };

  panel.querySelector('[data-tab="islands"]').addEventListener('click', scanIslands);
  setupMutationObservers();

  // Listen to explicit state update ports
  window.addEventListener('elm-ssr-state-update', (event) => {
    if (event.detail) {
      const marker = findMarkerByOrigin(event.detail);
      if (marker) {
        islandActiveStates.set(marker, event.detail.state);
        const activeTab = panel.querySelector('.debug-tab.active')?.getAttribute('data-tab');
        if (activeTab === 'islands') {
          scanIslands();
        }
      }
    }
  });

  const bridgeLog = panel.querySelector('#debug-bridges-log');
  let firstBridge = true;
  window.addEventListener('elm-ssr-broadcast', (event) => {
    if (firstBridge) {
      bridgeLog.innerHTML = '';
      firstBridge = false;
    }
    
    const tag = event.detail && event.detail.tag || 'Unknown';
    const payload = event.detail && event.detail.payload;
    const time = new Date().toLocaleTimeString();
    
    // Check if it is a state update event
    if (tag === '__elmssr_state__' && event.detail.__elmssr_origin) {
      const marker = findMarkerByOrigin(event.detail.__elmssr_origin);
      if (marker) {
        islandActiveStates.set(marker, payload);
        const activeTab = panel.querySelector('.debug-tab.active')?.getAttribute('data-tab');
        if (activeTab === 'islands') {
          scanIslands();
        }
      }
    }
     const li = document.createElement('li');
    li.className = 'debug-item';
    li.innerHTML = \`
      <div class="debug-item-meta" style="flex: 1;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="debug-badge badge-success">\${tag}</span>
          <span style="color: #9ca3af; font-size: 0.85em;">\${time}</span>
        </div>
        <pre class="debug-code" style="color: #fbbf24;">\${JSON.stringify(payload, null, 2)}</pre>
      </div>
    \`;
    
    bridgeLog.insertBefore(li, bridgeLog.firstChild);
  });

  // Handle SPA live updates
  const updatePanel = (newData) => {
    const overviewPane = panel.querySelector('#pane-overview');
    overviewPane.innerHTML = \`
      <div class="overview-grid">
        <div class="overview-card">
          <div class="overview-label">Request Method & Path</div>
          <div class="overview-val">\${newData.method} \${new URL(newData.url).pathname}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">HTTP Status</div>
          <div class="overview-val \${newData.status < 400 ? 'status-ok' : 'status-error'}">\${newData.status}</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">Server Render Time</div>
          <div class="overview-val">\${newData.durationMs.toFixed(1)} ms</div>
        </div>
        <div class="overview-card">
          <div class="overview-label">Database & Effects</div>
          <div class="overview-val">\${(newData.effects || []).length} calls</div>
        </div>
      </div>
    \`;
    
    const dbPane = panel.querySelector('#pane-database');
    dbPane.innerHTML = getDbHtml(newData.effects);
    
    const effectsPane = panel.querySelector('#pane-effects');
    effectsPane.innerHTML = getEffectsHtml(newData.effects);
    
    const sessionPane = panel.querySelector('#pane-session');
    sessionPane.innerHTML = \`
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div>
          <strong>Session Data:</strong>
          <pre class="debug-code" style="color: #818cf8;">\${JSON.stringify(newData.session, null, 2) || 'null'}</pre>
        </div>
      </div>
    \`;
    
    setupMutationObservers(); // Observe any newly mounted islands
    
    const activeTab = panel.querySelector('.debug-tab.active').getAttribute('data-tab');
    if (activeTab === 'islands') {
      scanIslands();
    }
  };

  window.addEventListener('elm-ssr-debug-update', (event) => {
    if (event.detail) {
      updatePanel(event.detail);
    }
  });
})();
  `;

  const injectSnippet = `<script type="text/javascript">${scriptContent}</script>`;
  const bodyCloseIndex = html.lastIndexOf("</body>");
  if (bodyCloseIndex !== -1) {
    return html.slice(0, bodyCloseIndex) + injectSnippet + html.slice(bodyCloseIndex);
  }
  return html + injectSnippet;
};
