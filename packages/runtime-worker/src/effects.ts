export interface LoaderEffect {
  kind: string;
  payload: Record<string, unknown>;
}

export interface LoaderEffectResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Runs a single side effect requested by an Elm loader. This is the only place
 * a loader's IO actually happens — the Elm side just describes what it needs.
 */
export type EffectRunner = (effect: LoaderEffect) => Promise<LoaderEffectResult>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const normalizeEffect = (value: unknown): LoaderEffect => {
  if (isRecord(value) && typeof value.kind === "string") {
    return {
      kind: value.kind,
      payload: isRecord(value.payload) ? value.payload : {}
    };
  }

  return { kind: "unknown", payload: {} };
};

export const defaultEffectRunner: EffectRunner = async (effect) => {
  if (effect.kind === "fetchJson") {
    const url = typeof effect.payload.url === "string" ? effect.payload.url : "";

    try {
      const response = await fetch(url);

      if (!response.ok) {
        return { ok: false, error: `fetchJson received ${response.status} from ${url}` };
      }

      return { ok: true, value: await response.json() };
    } catch (error) {
      return { ok: false, error: `fetchJson failed for ${url}: ${String(error)}` };
    }
  }

  if (effect.kind === "kvGet") {
    return { ok: false, error: "kvGet not implemented in default runner" };
  }

  if (effect.kind === "kvPut") {
    return { ok: false, error: "kvPut not implemented in default runner" };
  }

  if (effect.kind === "getCookie") {
    return { ok: false, error: "getCookie not implemented in default runner" };
  }

  if (effect.kind === "d1Query") {
    const { mode } = effect.payload as { mode: string };
    if (mode === "run") {
      return { ok: true, value: { success: true, changes: 0 } };
    }
    if (mode === "first") {
      return { ok: true, value: null };
    }
    return { ok: true, value: [] };
  }

  return { ok: false, error: `Unknown loader effect: ${effect.kind}` };
};
