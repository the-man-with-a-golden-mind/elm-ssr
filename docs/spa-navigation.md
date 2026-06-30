# SPA Navigation

elm-ssr ships a thin client-side navigation layer that makes in-app links feel
instant without a full page reload. It is wired up automatically whenever
a page has islands — no configuration required.

## How it works

1. The island runtime intercepts `<a>` clicks whose `href` is a same-origin
   path (not external, not `#` fragments, not `target=_blank`).
2. It POSTs to `/api/render?path=/new-path` to get the server-rendered HTML
   for the new route.
3. It swaps `#elm-ssr-root` innerHTML, syncs `<head>` (adds new stylesheets,
   removes orphaned ones), updates `document.title`, and pushes a history
   entry.
4. Islands in the new page are booted. Islands that carried a matching `id`
   from the previous page are **transferred** (not torn down) — see below.

Pages with **no islands** (`Document Never` from `Loader.succeed`) never load
the island runtime, so navigation works as normal browser requests.

## The `/api/render` endpoint

The endpoint is built into every elm-ssr worker. It accepts:

```
GET /api/render?path=/some-route
```

and returns:

```json
{
  "path": "/some-route",
  "status": 200,
  "html": "<main>…</main>"
}
```

or, for redirects:

```json
{ "redirect": "/login" }
```

The client follows redirects returned by this endpoint without a page reload.
This means `Loader.redirect "/login"` inside a page loader works correctly
during SPA navigation — the browser ends up at `/login` without a full reload.

The endpoint honours the same effect stack as normal page requests, so
sessions, CSRF, database reads, and `Loader.requireUser` all work identically.

## Form submissions

Progressive enhancement: the island runtime also intercepts `<form method="post">` submissions within `#elm-ssr-root`. The form data is POSTed
to the form's `action` URL, and the response (typically a 302 redirect) is
followed by the SPA router rather than the browser.

This means server-rendered forms work in both JS-enabled and JS-disabled
environments — with JS, navigation is seamless; without JS, the browser
handles the normal HTTP cycle.

## Island persistence across navigation

By default, every island is torn down when the page changes and re-initialised
from the new page's flags. To **keep an island alive** — preserving its Elm
runtime state, subscriptions, and DOM — give it a stable `id`:

```elm
-- In the page that embeds the island:
MiniCart.embed
    { cartItems = data.cartItems }
    |> Island.embed "MiniCart"
        { encodeFlags = encodeFlags
        , fallback    = \_ -> []
        , id          = Just "mini-cart"   -- persist across navigation
        }
```

When the runtime navigates to a new page, it looks for an
`<elm-ssr-island data-elmssr-id="mini-cart">` in the new HTML. If found, it
transplants the live element (with its Elm runtime state intact) from the old
page into the new one instead of creating a fresh island.

**When to use persistence:**
- Shopping cart / sidebar that must not reset between page views
- Audio / video player that continues playing
- Global notification tray
- Real-time data feed (SSE stream continues uninterrupted)

**When not to:**
- Most islands should NOT be persistent — fresh state from server props is
  usually the right behaviour and is simpler to reason about.

## Head synchronisation

After each navigation, the runtime diffs the `<head>`:

- `<title>` is updated to the new page's title.
- `<link rel="stylesheet">` elements present in the new page but absent from
  the current head are appended (no flash of unstyled content for common
  shared stylesheets).
- `<link>` elements no longer referenced by the new page are removed.
- `<meta>` elements are NOT diffed — they come from the initial SSR and do
  not change on navigation.

## Navigation lifecycle events (for pending states & revalidation)

During SPA navigation the runtime dispatches these `window` events that islands (or global code) can listen to for loading/pending UI:

- `elm-ssr-navigation-start` — { url }
- `elm-ssr-navigation-end` — { url, ok }

```js
window.addEventListener("elm-ssr-navigation-start", () => { showSpinner(); });
window.addEventListener("elm-ssr-navigation-end", (e) => { hideSpinner(); if (!e.detail.ok) { ... } });
```

In an island you can forward via a port or `Browser.Events.on` wrapper + Task.

This gives a lightweight hook for revalidation pending states without framework `useLoader`.

## SSE connections and navigation

Non-persistent islands are torn down on navigation. The client runtime closes
their `EventSource` connections automatically. Persistent islands keep their
connections alive across navigations.

On hard reload or tab close, all EventSources close. The server's `signal`
fires, allowing the handler loop to exit promptly.

## Hash links

Links whose `href` starts with `#` are left to the browser. They do not
trigger the SPA router.

## External links

Links to different origins (`https://other.com`) are left to the browser.
Same-origin links with `target="_blank"` open in a new tab normally.

## Opting out of SPA navigation

The SPA router only runs when the island runtime is loaded, which only happens
when a page has at least one island. A `Document Never` page that returns
`Loader.succeed view` with no islands never loads any client JavaScript at all
— links on that page behave as normal browser navigation.

If you want a specific link to force a full reload even on a page that has
islands, use a `data-no-spa` attribute (the runtime skips these):

```html
<a href="/logout" data-no-spa>Sign out</a>
```

Or in Elm:
```elm
ElmSsr.Html.a [ Attr.attr "data-no-spa" "", Attr.href "/logout" ] [ text "Sign out" ]
```

## Source

- [packages/elm-ssr/src/client-runtime/islands.ts](../packages/elm-ssr/src/client-runtime/islands.ts) — the full SPA router + head sync logic
- [packages/elm-ssr/src/request-handler.ts](../packages/elm-ssr/src/request-handler.ts) — `/api/render` endpoint
