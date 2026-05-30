export interface RenderFlagsContext {
  request: Request;
  url: URL;
  path: string;
  formData?: Record<string, string>;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface WorkerHandler {
  fetch(request: Request, env?: unknown, executionCtx?: WorkerExecutionContext): Promise<Response>;
}

export interface AppContext {
  request: Request;
  url: URL;
  requestId: string;
  startedAt: number;
  executionCtx?: WorkerExecutionContext;
  env?: Record<string, unknown>;
}

export interface RouteDefinition {
  path: string;
  methods: string[];
  description: string;
}

export interface RouteCatalog {
  pages: RouteDefinition[];
  assets: RouteDefinition[];
  utility: RouteDefinition[];
  api: RouteDefinition[];
}

export interface RenderResult {
  html: string;
  status: number;
}

export type RenderFlagsFactory = (context: RenderFlagsContext) => Record<string, unknown>;

export type AppHandler = (context: AppContext) => Promise<Response>;

export type Middleware = (context: AppContext, next: AppHandler) => Promise<Response>;

export const withHeaders = (response: Response, headers: HeadersInit): Response => {
  const merged = new Headers(response.headers);
  new Headers(headers).forEach((value, key) => {
    merged.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged
  });
};

export const json = (body: unknown, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers
  });
};

export const text = (body: string, init: ResponseInit = {}): Response => {
  const headers = new Headers(init.headers);

  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }

  return new Response(body, {
    ...init,
    headers
  });
};
