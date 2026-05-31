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
