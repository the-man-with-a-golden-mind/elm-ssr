# Development Debugger Panel (DevTools)

`elm-ssr` includes a built-in visual development debugger panel that automatically injects into your application pages during local development. It is designed to help you inspect static vs. interactive layout boundaries, monitor SQL database queries, verify session states, and track cross-island events.

---

## 1. Getting Started

By default, the debugger is **automatically enabled** in development and test environments (`process.env.NODE_ENV === "development"` or `"test"`). 

You can explicitly configure the debugger using the `debug` option when initializing your worker app:

```ts
// runtime.ts
export const worker = createWorkerApp({
  elmModule,
  islands,
  stylesheet,
  routes,
  createFlags,
  debug: true // Force enable/disable the debugger panel
});
```

When enabled, a floating **⚡ Debug** toggle button will appear in the bottom-right corner of your pages. Clicking it slides open the DevTools drawer.

---

## 2. DevTools Console Tabs

The debugger console is divided into five interactive panes:

### Overview
Displays vital request stats, including:
- **Request Metadata**: The HTTP method and resolved path of the current page.
- **HTTP Status Code**: Highlighted green for success (2xx) or red for errors (4xx/5xx).
- **Server Render Time**: The total time taken on the edge/server to run loaders, resolve effects, and serialize the document to HTML.
- **Database & Effects**: The count of executed loader/action side-effects.

### Islands
Lists all client-side interactive islands currently mounted on the page.
- **Boot Status**: Shows whether each island is `BOOTED` or `INITIALIZING`.
- **Props Inspector**: Displays a formatted JSON tree of the props (flags) passed from the parent page to this island instance.
- **Visual Highlighter**: Hovering over any island item in the debugger list will highlight that island on the page with a dashed purple border and semi-transparent overlay. This is highly useful for identifying interactive islands vs. static SSR regions.

### Effects
Logs a complete timeline of all database queries, cache operations, environment variable lookups, and JSON fetches executed on the server to render the current page.
- **SQL Profiler**: Lists the raw SQL statement and its parameters.
- **Duration Timing**: Shows the exact latency (in milliseconds) of each query or effect.
- **Status Checks**: Displays whether each effect succeeded or failed.

### Session
Displays the active request session data decoded from the signed cookie. It updates dynamically as you perform login/logout actions.

### Bridges
Monitors the cross-island event bus in real-time. Any broadcast sent via `ElmSsr.Island.Shared.broadcast` will be logged here, displaying:
- The event **Tag** name.
- The event **Payload** as a formatted JSON tree.
- The exact local **Timestamp** the event was intercepted.

---

## 3. SPA Mode Progressive Sync

The debugger integrates with `elm-ssr`'s progressive client-side routing. When you click same-origin links to navigate between pages progressively (SPA mode), the client-side router fetches `/api/render?path=...`. 

The response automatically packs a `debug` metadata payload which the debugger console intercepts. The console then updates its overview, query log, and session tabs in real-time without requiring a full browser refresh.
