export interface SsrPropertyAttribute {
  kind: "attribute";
  name: string;
  value: string;
}

export interface SsrEventAttribute {
  kind: "event";
  name: string;
  payload: unknown;
  capture: "none" | "value";
}

export type SsrAttribute = SsrPropertyAttribute | SsrEventAttribute;

export interface SsrElementNode {
  kind: "element";
  tag: string;
  attrs: SsrAttribute[];
  children: SsrNode[];
  key?: string;
}

export interface SsrVoidNode {
  kind: "void";
  tag: string;
  attrs: SsrAttribute[];
  key?: string;
}

export interface SsrTextNode {
  kind: "text";
  text: string;
  key?: string;
}

export type SsrNode = SsrElementNode | SsrVoidNode | SsrTextNode;

export interface SsrDocument {
  status: number;
  lang: string;
  hasIslands: boolean;
  head: SsrNode[];
  body: SsrNode[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isAttribute = (value: unknown): value is SsrAttribute => {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.name !== "string") {
    return false;
  }

  if (value.kind === "attribute") {
    return typeof value.value === "string";
  }

  if (value.kind === "event") {
    return "payload" in value && (value.capture === "none" || value.capture === "value");
  }

  return false;
};

const isNode = (value: unknown): value is SsrNode => {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.key !== undefined && typeof value.key !== "string") {
    return false;
  }

  if (value.kind === "text") {
    return typeof value.text === "string";
  }

  if ((value.kind === "element" || value.kind === "void") && typeof value.tag === "string" && Array.isArray(value.attrs)) {
    if (!value.attrs.every(isAttribute)) {
      return false;
    }

    if (value.kind === "element") {
      return Array.isArray(value.children) && value.children.every(isNode);
    }

    return true;
  }

  return false;
};

export const assertDocument = (value: unknown): SsrDocument => {
  if (
    !isRecord(value)
    || typeof value.status !== "number"
    || typeof value.lang !== "string"
    || typeof value.hasIslands !== "boolean"
    || !Array.isArray(value.head)
    || !Array.isArray(value.body)
    || !value.head.every(isNode)
    || !value.body.every(isNode)
  ) {
    throw new Error("Elm SSR returned an invalid document payload.");
  }

  return value as unknown as SsrDocument;
};

export const toDomAttribute = (attribute: SsrAttribute): { name: string; value: string } => {
  if (attribute.kind === "attribute") {
    return {
      name: attribute.name,
      value: attribute.value
    };
  }

  return {
    name: `data-elmssr-event-${attribute.name}`,
    value: encodeURIComponent(JSON.stringify({
      ...((isRecord(attribute.payload) ? attribute.payload : {}) as Record<string, unknown>),
      capture: attribute.capture
    }))
  };
};
