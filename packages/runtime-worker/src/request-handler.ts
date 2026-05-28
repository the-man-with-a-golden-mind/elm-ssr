import type { IslandAsset } from "./app";
import { createIslandsRuntimeSource } from "./client-runtime/islands";
import type { AppContext, AppHandler, RenderFlagsFactory, RouteCatalog } from "./http";
import { json, text } from "./http";
import { type EffectRunner } from "./effects";
import { renderApp, type CompiledElmModule } from "./render";
import { renderHtmlDocument } from "./serialize";
import { assetHeaders, cssHeaders, htmlHeaders, jsonHeaders } from "./response-headers";

const isReadMethod = (method: string): boolean => method === "GET" || method === "HEAD";

const methodNotAllowed = (context: AppContext): Response => {
  if (context.url.pathname.startsWith("/api/")) {
    return json(
      {
        error: "method_not_allowed",
        allowed: ["GET", "HEAD"]
      },
      { status: 405, headers: jsonHeaders }
    );
  }

  return text("Method Not Allowed", { status: 405 });
};

const createFlagsFromContext = (
  context: AppContext,
  path: string,
  createFlags: RenderFlagsFactory
): Record<string, unknown> =>
  createFlags({
    request: context.request,
    url: context.url,
    path
  });

export interface RequestHandlerOptions {
  elmModule: CompiledElmModule;
  islands?: Record<string, IslandAsset>;
  stylesheet: string;
  routes: RouteCatalog;
  createFlags: RenderFlagsFactory;
  effects?: EffectRunner;
}

export const createRequestHandler = ({
  elmModule,
  islands,
  stylesheet,
  routes,
  createFlags,
  effects
}: RequestHandlerOptions): AppHandler =>
  async (context) => {
    if (!isReadMethod(context.request.method)) {
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

    if (context.url.pathname.startsWith("/__elm-ssr/islands/") && context.url.pathname.endsWith(".js") && islands) {
      const islandName = context.url.pathname.slice("/__elm-ssr/islands/".length, -".js".length);
      const island = islands[islandName];

      if (island) {
        return new Response(island.source, {
          status: 200,
          headers: assetHeaders
        });
      }
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

      const flags = createFlagsFromContext(context, targetPath, createFlags);
      const rendered = await renderApp(elmModule, flags, { effects });

      return json(
        {
          path: targetPath,
          status: rendered.status,
          html: renderHtmlDocument(rendered.document)
        },
        { status: 200, headers: jsonHeaders }
      );
    }

    const flags = createFlagsFromContext(context, context.url.pathname + context.url.search, createFlags);
    const rendered = await renderApp(elmModule, flags, { effects });
    const html = renderHtmlDocument(rendered.document);

    return new Response(html, {
      status: rendered.status,
      headers: htmlHeaders
    });
  };
