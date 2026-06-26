import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";

type ElmBrowserModule = Record<string, unknown>;

const lookupModule = (elmModule: ElmBrowserModule, moduleName: string): { init(options: { node: Element; flags: unknown }): unknown } => {
  const moduleRef = moduleName.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }

    return undefined;
  }, elmModule);

  if (!moduleRef || typeof moduleRef !== "object" || typeof (moduleRef as { init?: unknown }).init !== "function") {
    throw new Error(`Missing Browser.element init for ${moduleName}`);
  }

  return moduleRef as { init(options: { node: Element; flags: unknown }): unknown };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let window: Window;
let previousGlobals: Map<string, unknown>;

const installWindowGlobals = (nextWindow: Window) => {
  const assignments: Array<[string, unknown]> = [
    ["window", nextWindow],
    ["document", nextWindow.document],
    ["navigator", nextWindow.navigator],
    ["Node", nextWindow.Node],
    ["Element", nextWindow.Element],
    ["HTMLElement", nextWindow.HTMLElement],
    ["HTMLInputElement", nextWindow.HTMLInputElement],
    ["HTMLButtonElement", nextWindow.HTMLButtonElement],
    ["HTMLTextAreaElement", nextWindow.HTMLTextAreaElement],
    ["HTMLSelectElement", nextWindow.HTMLSelectElement],
    ["MutationObserver", nextWindow.MutationObserver],
    ["Event", nextWindow.Event],
    ["MouseEvent", nextWindow.MouseEvent],
    ["requestAnimationFrame", nextWindow.requestAnimationFrame.bind(nextWindow)],
    ["cancelAnimationFrame", nextWindow.cancelAnimationFrame.bind(nextWindow)]
  ];

  previousGlobals = new Map(assignments.map(([key]) => [key, Reflect.get(globalThis, key)]));

  for (const [key, value] of assignments) {
    Reflect.set(globalThis, key, value);
  }
};

const restoreWindowGlobals = () => {
  for (const [key, value] of previousGlobals.entries()) {
    Reflect.set(globalThis, key, value);
  }
};

const mountIsland = (runtime: ElmBrowserModule, moduleName: string, flags: unknown): Element => {
  const root = window.document.createElement("div");
  window.document.body.appendChild(root);
  lookupModule(runtime, moduleName).init({ node: root, flags });
  return root;
};

const loadRuntime = async (path: string): Promise<ElmBrowserModule> => {
  Reflect.deleteProperty(globalThis, "Elm");
  const moduleRef = await import(`${path}?cache=${Date.now()}-${Math.random()}`);
  return moduleRef.default as ElmBrowserModule;
};

const findByClass = (root: Element, className: string): Element => {
  const walk = (node: Element): Element | null => {
    const classAttr = node.getAttribute("class") || "";

    if (classAttr.split(/\s+/).includes(className)) {
      return node;
    }

    for (const child of Array.from(node.children)) {
      const match = walk(child as Element);

      if (match) {
        return match;
      }
    }

    return null;
  };

  const match = walk(root);

  if (!match) {
    throw new Error(`Expected .${className}`);
  }

  return match;
};

beforeEach(() => {
  window = new Window();
  installWindowGlobals(window);
});

afterEach(() => {
  restoreWindowGlobals();
});

// Returns both the root element and the live Elm app (with ports).
const mountIslandWithApp = (
  runtime: ElmBrowserModule,
  moduleName: string,
  flags: unknown
): { root: Element; app: { ports?: Record<string, { subscribe?: (fn: (v: unknown) => void) => void; send?: (v: unknown) => void }> } } => {
  const root = window.document.createElement("div");
  window.document.body.appendChild(root);
  const app = lookupModule(runtime, moduleName).init({ node: root, flags });
  return { root, app: app as { ports?: Record<string, { subscribe?: (fn: (v: unknown) => void) => void; send?: (v: unknown) => void }> } };
};

// Wire the island Shared bus ports to the window CustomEvent mechanism,
// mirroring what the production client runtime does in `wireBus`.
const wireSharedBus = (
  app: { ports?: Record<string, { subscribe?: (fn: (v: unknown) => void) => void; send?: (v: unknown) => void }> }
): (() => void) => {
  const teardowns: Array<() => void> = [];
  const ports = app.ports ?? {};

  if (ports.broadcastOut?.subscribe) {
    ports.broadcastOut.subscribe((event) => {
      window.dispatchEvent(new window.CustomEvent("elm-ssr-broadcast", { detail: event }) as unknown as Event);
    });
  }

  if (ports.broadcastIn?.send) {
    const handler = (e: Event) => ports.broadcastIn!.send!((e as CustomEvent).detail);
    window.addEventListener("elm-ssr-broadcast", handler as EventListener);
    teardowns.push(() => window.removeEventListener("elm-ssr-broadcast", handler as EventListener));
  }

  return () => teardowns.forEach((fn) => fn());
};

describe("Browser.element islands", () => {
  it("mounts the counter island and updates via normal Elm DOM events", async () => {
    const runtime = await loadRuntime("../generated/examples/basic/islands.mjs");
    const root = mountIsland(
      runtime,
      "Example.Basic.Islands.Counter",
      { start: 5 }
    );

    await tick();
    expect(root.textContent).toContain("5");

    findByClass(root, "btn-primary").dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    await tick();

    expect(root.textContent).toContain("6");
  });

  it("keeps Browser.element state isolated per mounted island", async () => {
    const runtime = await loadRuntime("../generated/examples/basic/islands.mjs");
    const alice = mountIsland(
      runtime,
      "Example.Basic.Islands.Counter",
      { start: 0 }
    );
    const bob = mountIsland(
      runtime,
      "Example.Basic.Islands.Counter",
      { start: 100 }
    );

    await tick();

    findByClass(alice, "btn-primary").dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    findByClass(bob, "btn-primary").dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    await tick();

    expect(alice.textContent).toContain("1");
    expect(bob.textContent).toContain("101");
    expect(alice.textContent).not.toContain("101");
  });

  it("cross-island Shared bus: Counter broadcast reaches the Observer island", async () => {
    const runtime = await loadRuntime("../generated/examples/basic/islands.mjs");

    // Mount Counter — broadcasts "count-changed" with the new count on Increment/Decrement/Reset.
    const { root: counterRoot, app: counterApp } = mountIslandWithApp(
      runtime,
      "Example.Basic.Islands.Counter",
      { start: 0 }
    );
    // Mount Observer — listens for "count-changed" and displays the last value.
    const { root: observerRoot, app: observerApp } = mountIslandWithApp(
      runtime,
      "Example.Basic.Islands.Observer",
      {}
    );

    // Wire both apps to the shared window CustomEvent bus.
    const teardownCounter = wireSharedBus(counterApp);
    const teardownObserver = wireSharedBus(observerApp);

    await tick();

    // Observer should start at 0 (its initial model).
    expect(observerRoot.textContent).toContain("0");

    // Click Increment on the counter (the primary button, class btn-primary).
    findByClass(counterRoot, "btn-primary").dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    await tick();

    // Counter should show 1.
    expect(counterRoot.textContent).toContain("1");
    // Observer should have received the broadcast and also show 1.
    expect(observerRoot.textContent).toContain("1");

    // Click Increment a second time.
    findByClass(counterRoot, "btn-primary").dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    await tick();
    expect(observerRoot.textContent).toContain("2");

    teardownCounter();
    teardownObserver();
  });

  it("ElmSsr.Island.Sse: Live island decodes incoming SSE events through the port and updates its view", async () => {
    // The Live island opens a server-sent-events stream in init (Sse.open url).
    // The client runtime normally wires up a real EventSource; in tests we skip
    // that and drive the island directly through its Elm ports.
    //
    // What this tests: Sse.events subscription, Sse.match + tickDecoder, and
    // the update → view pipeline after a successful decode.
    const runtime = await loadRuntime("../generated/examples/basic/islands.mjs");
    const { root, app } = mountIslandWithApp(runtime, "Example.Basic.Islands.Live", {});

    await tick();

    // Before any event arrives, the island shows its "waiting" state.
    expect(root.textContent).toContain("waiting for first server event");

    // Simulate the client runtime delivering an SSE event via the incoming port.
    const ports = app.ports as Record<string, { send?: (v: unknown) => void }>;
    if (!ports?.sseEventIn?.send) {
      throw new Error("sseEventIn port not found on Live island");
    }

    ports.sseEventIn.send({
      url: "/__elm-ssr/live",
      data: JSON.stringify({ time: "2026-06-25T12:00:00.000Z", n: 7 })
    });
    await tick();

    // The island decoded the tick and rendered it.
    expect(root.textContent).toContain("7");
    expect(root.textContent).toContain("2026-06-25");

    // A second event should update the counter.
    ports.sseEventIn.send({
      url: "/__elm-ssr/live",
      data: JSON.stringify({ time: "2026-06-25T12:00:01.000Z", n: 8 })
    });
    await tick();
    expect(root.textContent).toContain("8");
    expect(root.textContent).not.toContain("7"); // old value replaced
  });

  it("ElmSsr.Island.Sse: Live island ignores events for a different URL (Sse.match filter)", async () => {
    const runtime = await loadRuntime("../generated/examples/basic/islands.mjs");
    const { root, app } = mountIslandWithApp(runtime, "Example.Basic.Islands.Live", {});
    await tick();

    const ports = app.ports as Record<string, { send?: (v: unknown) => void }>;
    if (!ports?.sseEventIn?.send) throw new Error("sseEventIn port not found");

    // Deliver an event for a DIFFERENT URL — Sse.match should return Nothing.
    ports.sseEventIn.send({
      url: "/__elm-ssr/other",
      data: JSON.stringify({ time: "2026-06-25T12:00:00.000Z", n: 99 })
    });
    await tick();

    // Model unchanged — still shows the initial waiting state.
    expect(root.textContent).toContain("waiting for first server event");
    expect(root.textContent).not.toContain("99");
  });

  it("uses native Html.Keyed reconciliation in the tasks island", async () => {
    const runtime = await loadRuntime("../generated/examples/basic/islands.mjs");
    const root = mountIsland(
      runtime,
      "Example.Basic.Islands.Tasks",
      { items: ["alpha", "beta", "gamma"] }
    );

    await tick();

    const rows = Array.from(root.getElementsByTagName("li"));
    const betaRow = rows.find((row) => row.textContent?.includes("beta"));

    if (!betaRow) {
      throw new Error("Missing beta row");
    }

    const betaInput = findByClass(betaRow, "task-note") as unknown as HTMLInputElement;
    betaInput.value = "remember me";
    betaInput.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    await tick();

    findByClass(betaRow, "task-up").dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
    await tick();

    const reorderedRows = Array.from(root.getElementsByTagName("li"));
    const movedRow = reorderedRows[0];
    const movedInput = findByClass(movedRow, "task-note") as unknown as HTMLInputElement;

    expect(reorderedRows.map((row) => findByClass(row, "task-label").textContent)).toEqual(["beta", "alpha", "gamma"]);
    expect(movedInput).toBe(betaInput);
    expect(movedInput.value).toBe("remember me");
  });
});
