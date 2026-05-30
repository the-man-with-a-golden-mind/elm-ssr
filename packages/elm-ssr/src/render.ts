import { defaultEffectRunner, normalizeEffect, type EffectContext, type EffectRunner } from "./effects";
import { assertDocument, type SsrDocument } from "./protocol";

export interface ElmPorts {
  rendered: {
    subscribe(callback: (value: unknown) => void): void;
  };
  start: {
    send(value: boolean): void;
  };
  effectRequest: {
    subscribe(callback: (value: unknown) => void): void;
  };
  effectResult: {
    send(value: unknown): void;
  };
}

export interface ElmRuntimeInstance {
  ports: ElmPorts;
}

export interface CompiledElmModule {
  Main: {
    init(options: { flags: Record<string, unknown> }): ElmRuntimeInstance;
  };
}

/** A `Set-Cookie` directive emitted from the Elm side (via `Action.setCookie`). */
export interface SetCookieDirective {
  name: string;
  value: string;
  maxAge?: number | null;
  expires?: string | null;
  domain?: string | null;
  path?: string | null;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none" | null;
}

export interface RenderedDocument {
  document: SsrDocument;
  status: number;
  redirect?: string;
  json?: unknown;
  cookies?: SetCookieDirective[];
}

export interface RenderOptions {
  effects?: EffectRunner;
  effectContext?: EffectContext;
  timeoutMs?: number;
}

interface ActionStep {
  kind: "resolved" | "errored" | "redirect" | "json";
  status?: number;
  message?: string;
  url?: string;
  value?: unknown;
  cookies?: SetCookieDirective[];
}

const normalizeCookies = (cookies: SetCookieDirective[] | undefined): SetCookieDirective[] | undefined =>
  cookies && cookies.length > 0 ? cookies : undefined;

export const renderApp = async (
  elmModule: CompiledElmModule,
  flags: Record<string, unknown>,
  options: RenderOptions = {}
): Promise<RenderedDocument> => {
  const runEffect = options.effects ?? defaultEffectRunner;
  const effectContext = options.effectContext ?? {};
  const timeoutMs = options.timeoutMs ?? 5000;

  const payload = await new Promise<unknown>((resolve, reject) => {
    const app = elmModule.Main.init({ flags });
    const timeout = setTimeout(() => reject(new Error("Elm SSR render timed out.")), timeoutMs);

    app.ports.rendered.subscribe((value: unknown) => {
      clearTimeout(timeout);
      resolve(value);
    });

    app.ports.effectRequest.subscribe((request: unknown) => {
      void Promise.resolve()
        .then(() => runEffect(normalizeEffect(request), effectContext))
        .then((result) => app.ports.effectResult.send(result))
        .catch((error: unknown) => app.ports.effectResult.send({ ok: false, error: String(error) }));
    });

    app.ports.start.send(true);
  });

  const step = payload as ActionStep;

  const cookies = normalizeCookies(step.cookies);

  if (step.kind === "redirect") {
    return {
      status: 302,
      redirect: step.url,
      document: { status: 302, lang: "en", hasIslands: false, head: [], body: [] },
      cookies
    };
  }

  if (step.kind === "json") {
    return {
      status: 200,
      json: step.value,
      document: { status: 200, lang: "en", hasIslands: false, head: [], body: [] },
      cookies
    };
  }

  if (step.kind === "errored") {
    const status = step.status ?? 500;
    const document = step.value ? assertDocument(step.value) : { status, lang: "en", hasIslands: false, head: [], body: [] };
    return {
      status,
      document,
      cookies
    };
  }

  const document = assertDocument(step.value);

  return {
    document,
    status: document.status,
    cookies
  };
};
