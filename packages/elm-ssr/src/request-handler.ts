import { serialize as serializeCookie } from "cookie";
import type { IslandMetadata } from "./app";
import { createIslandsRuntimeSource } from "./client-runtime/islands";
import type { AppContext, AppHandler, RenderFlagsFactory, RouteCatalog } from "./http";
import { json, text } from "./http";
import { type EffectRunner } from "./effects";
import { renderApp, type CompiledElmModule, type SetCookieDirective } from "./render";
import { renderHtmlDocument } from "./serialize";
import { assetHeaders, cssHeaders, htmlHeaders, jsonHeaders } from "./response-headers";

const formatCookie = (cookie: SetCookieDirective): string =>
  serializeCookie(cookie.name, cookie.value, {
    maxAge: cookie.maxAge ?? undefined,
    expires: cookie.expires ? new Date(cookie.expires) : undefined,
    domain: cookie.domain ?? undefined,
    path: cookie.path ?? undefined,
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    sameSite: cookie.sameSite ?? undefined
  });

const withSetCookies = (response: Response, cookies: SetCookieDirective[] | undefined): Response => {
  if (!cookies || cookies.length === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const cookie of cookies) {
    headers.append("set-cookie", formatCookie(cookie));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

const isReadMethod = (method: string): boolean => method === "GET" || method === "HEAD";

const isSupportedMethod = (method: string): boolean => method === "GET" || method === "HEAD" || method === "POST";

const methodNotAllowed = (context: AppContext): Response => {
  if (context.url.pathname.startsWith("/api/")) {
    return json(
      {
        error: "method_not_allowed",
        allowed: ["GET", "HEAD", "POST"]
      },
      { status: 405, headers: jsonHeaders }
    );
  }

  return text("Method Not Allowed", { status: 405 });
};

const parseFormData = async (request: Request): Promise<Record<string, string>> => {
  if (request.method !== "POST") {
    return {};
  }

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const data: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") {
          data[key] = value;
        }
      }
      return data;
    } catch {
      return {};
    }
  }

  if (contentType.includes("application/json")) {
    try {
      const data = await request.json();
      return typeof data === "object" && data !== null ? (data as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  return {};
};

const createFlagsFromContext = async (
  context: AppContext,
  path: string,
  createFlags: RenderFlagsFactory
): Promise<Record<string, unknown>> => {
  const formData = await parseFormData(context.request);
  return createFlags({
    request: context.request,
    url: context.url,
    path,
    formData
  });
};

export interface RequestHandlerOptions {
  elmModule: CompiledElmModule;
  islands?: Record<string, IslandMetadata>;
  islandsBundle?: string;
  stylesheet: string;
  routes: RouteCatalog;
  createFlags: RenderFlagsFactory;
  effects?: EffectRunner;
}

export const createRequestHandler = ({
  elmModule,
  islands,
  islandsBundle,
  stylesheet,
  routes,
  createFlags,
  effects
}: RequestHandlerOptions): AppHandler =>
  async (context) => {
    if (!isSupportedMethod(context.request.method)) {
      return methodNotAllowed(context);
    }

    if (context.url.pathname === "/health") {
      return text("ok", { status: 200 });
    }

    if (context.url.pathname === "/styles.css") {
      return new Response(stylesheet, {
        status: 200,
        headers: cssHeaders
      });
    }

    if (context.url.pathname === "/__elm-ssr/islands.js" && islands && Object.keys(islands).length > 0) {
      return new Response(createIslandsRuntimeSource(islands), {
        status: 200,
        headers: assetHeaders
      });
    }

    if (context.url.pathname === "/__elm-ssr/islands-bundle.js" && islandsBundle) {
      return new Response(islandsBundle, {
        status: 200,
        headers: assetHeaders
      });
    }

    if (context.url.pathname === "/api/health") {
      return json(
        {
          ok: true,
          service: "elmssr",
          runtime: "cloudflare-worker",
          requestId: context.requestId
        },
        { status: 200, headers: jsonHeaders }
      );
    }

    if (context.url.pathname === "/api/routes") {
      return json(routes, {
        status: 200,
        headers: jsonHeaders
      });
    }

    if (context.url.pathname === "/api/render") {
      const targetPath = context.url.searchParams.get("path");

      if (!targetPath || !targetPath.startsWith("/")) {
        return json(
          {
            error: "invalid_path",
            message: "Use /api/render?path=/some-route"
          },
          { status: 400, headers: jsonHeaders }
        );
      }

      const flags = await createFlagsFromContext(context, targetPath, createFlags);
      const rendered = await renderApp(elmModule, flags, {
        effects,
        effectContext: {
          env: context.env,
          request: context.request,
          waitUntil: context.executionCtx ? (promise) => context.executionCtx?.waitUntil(promise) : undefined
        }
      });

      if (rendered.redirect) {
        return json({ redirect: rendered.redirect }, { status: 200, headers: jsonHeaders });
      }

      if (rendered.json) {
        return json(rendered.json, { status: 200, headers: jsonHeaders });
      }

      return json(
        {
          path: targetPath,
          status: rendered.status,
          html: renderHtmlDocument(rendered.document)
        },
        { status: 200, headers: jsonHeaders }
      );
    }

    const flags = await createFlagsFromContext(context, context.url.pathname + context.url.search, createFlags);
    const rendered = await renderApp(elmModule, flags, {
      effects,
      effectContext: { env: context.env, request: context.request }
    });

    if (rendered.redirect) {
      return withSetCookies(
        new Response(null, {
          status: 302,
          headers: { location: rendered.redirect }
        }),
        rendered.cookies
      );
    }

    if (rendered.json) {
      return withSetCookies(json(rendered.json, { status: 200, headers: jsonHeaders }), rendered.cookies);
    }

    const html = renderHtmlDocument(rendered.document);

    return withSetCookies(
      new Response(html, {
        status: rendered.status,
        headers: htmlHeaders
      }),
      rendered.cookies
    );
  };
