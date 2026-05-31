import type { EffectRunner } from "../effects";

/**
 * Intercepts session-related effects and routes them through `context.session`
 * (populated by `sessionMiddleware`). All other effects pass through unchanged.
 *
 * Effects handled:
 *   - `session`       → returns the current `session.data` (or null).
 *   - `csrfToken`     → returns the current `session.csrf` (or null).
 *   - `setSession`    → replaces `session.data` and marks the session `dirty`.
 *   - `clearSession`  → marks the session `destroyed` (middleware deletes + clears cookie).
 *
 * Without `sessionMiddleware` upstream, the session effects report an error so
 * mistakes are surfaced early instead of silently swallowed.
 */
export const sessionEffects = (runner: EffectRunner): EffectRunner =>
  async (effect, context) => {
    if (
      effect.kind === "session" ||
      effect.kind === "csrfToken" ||
      effect.kind === "setSession" ||
      effect.kind === "clearSession"
    ) {
      const session = context.session;
      if (!session) {
        return {
          ok: false,
          error: `Effect "${effect.kind}" requires sessionMiddleware to be installed.`
        };
      }

      if (effect.kind === "session") {
        return { ok: true, value: session.data };
      }

      if (effect.kind === "csrfToken") {
        return { ok: true, value: session.csrf };
      }

      if (effect.kind === "setSession") {
        session.data = effect.payload.value ?? null;
        session.dirty = true;
        return { ok: true, value: null };
      }

      // clearSession
      session.destroyed = true;
      return { ok: true, value: null };
    }

    return runner(effect, context);
  };
