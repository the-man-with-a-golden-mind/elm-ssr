import type { SsrAttribute, SsrDocument, SsrNode } from "./protocol";
import { toDomAttribute } from "./protocol";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

const renderNodeAttributes = (attributes: SsrAttribute[]): string => {
  if (attributes.length === 0) {
    return "";
  }

  return attributes
    .map((attribute) => {
      const domAttribute = toDomAttribute(attribute);
      return ` ${domAttribute.name}="${escapeHtml(domAttribute.value)}"`;
    })
    .join("");
};

const renderNode = (node: SsrNode): string => {
  if (node.kind === "text") {
    return escapeHtml(node.text);
  }

  const attrs = renderNodeAttributes(node.attrs);

  if (node.kind === "void") {
    return `<${node.tag}${attrs}>`;
  }

  return `<${node.tag}${attrs}>${node.children.map(renderNode).join("")}</${node.tag}>`;
};

export const renderNodes = (nodes: SsrNode[]): string =>
  nodes.map(renderNode).join("");

const hasIslandMarker = (nodes: SsrNode[]): boolean =>
  nodes.some((node) =>
    node.kind === "element" && (node.tag === "elm-ssr-island" || hasIslandMarker(node.children))
  );

// A page ships no JS unless it embeds an island; islands pull their own bootstrap.
const renderIslandShell = (document: SsrDocument): string =>
  hasIslandMarker(document.body) ? `<script type="module" src="/__elm-ssr/islands.js"></script>` : "";

export const renderHtmlDocument = (document: SsrDocument): string =>
  `<!doctype html><html lang="${escapeHtml(document.lang)}"><head>${renderNodes(document.head)}</head><body><div id="elm-ssr-root">${renderNodes(document.body)}</div>${renderIslandShell(document)}</body></html>`;
