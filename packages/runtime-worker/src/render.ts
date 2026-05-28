import { defaultEffectRunner, normalizeEffect, type EffectRunner } from "./effects";
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

export interface RenderedDocument {
  document: SsrDocument;
  status: number;
}

export interface RenderOptions {
  effects?: EffectRunner;
  timeoutMs?: number;
}

export const renderApp = async (
  elmModule: CompiledElmModule,
  flags: Record<string, unknown>,
  options: RenderOptions = {}
): Promise<RenderedDocument> => {
  const runEffect = options.effects ?? defaultEffectRunner;
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
        .then(() => runEffect(normalizeEffect(request)))
        .then((result) => app.ports.effectResult.send(result))
        .catch((error: unknown) => app.ports.effectResult.send({ ok: false, error: String(error) }));
    });

    app.ports.start.send(true);
  });

  const document = assertDocument(payload);

  return {
    document,
    status: document.status
  };
};
