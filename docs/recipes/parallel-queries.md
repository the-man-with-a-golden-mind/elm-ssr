# Recipe: parallel SQL queries with `Loader.custom`

`Loader` runs effects sequentially: `map2 a b` awaits `a` first, then `b`.
For independent queries that's wasted wall-clock. Three patterns, from
cheapest to most general:

1. **One SQL with CTEs + `json_build_object`** — Postgres plans it well,
   parallelises internally. Zero framework code.
2. **`Loader.custom` + `Promise.all` in your adapter** — this recipe. Use
   when queries hit different sources (different DB, cache + SQL, external
   API) or when CTEs get ugly.
3. **Native `Loader.parallel`** — not in the framework yet (would need a
   protocol change in the effect loop). Open an issue if you want it.

## The pattern

### 1. Define a custom effect from Elm

```elm
import Json.Decode as Decode
import Json.Encode as Encode
import ElmSsr.Loader as Loader exposing (Loader)


type alias Dashboard =
    { totalOrders : Int
    , recentOrderIds : List Int
    , topCountries : List { country : String, total : Int }
    }


dashboard : Loader Dashboard
dashboard =
    Loader.custom
        { kind = "parallelDashboard"
        , payload = Encode.object []   -- pass filters etc. here
        , decoder = dashboardDecoder
        }
```

`Loader.custom` emits an effect with the `kind` of your choice. Your TS-side
runner intercepts it; the rest of the world doesn't know it exists.

### 2. Wrap your effect runner

```ts
import type { EffectRunner } from "elm-ssr/effects";
import { inMemoryEffects } from "elm-ssr/effects";
import { postgresSql } from "elm-ssr/backends";

const baseEffects: EffectRunner = inMemoryEffects({
  sql: postgresSql({ run: (q, p) => pg.run(q, p) })
});

export const myEffects: EffectRunner = async (effect, ctx) => {
  if (effect.kind === "parallelDashboard") {
    // Three independent queries; await once, not three times.
    const [totals, recent, byCountry] = await Promise.all([
      pg.unsafe("SELECT count(*)::int AS c FROM orders"),
      pg.unsafe("SELECT id FROM orders ORDER BY created DESC LIMIT 10"),
      pg.unsafe("SELECT country, sum(total)::int AS total FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 5")
    ]);

    return {
      ok: true,
      value: {
        totalOrders: totals[0].c,
        recentOrderIds: recent.map((r) => r.id),
        topCountries: byCountry
      }
    };
  }

  // Forward everything else to the base runner.
  return baseEffects(effect, ctx);
};
```

Pass `myEffects` to `createWorkerApp({ effects: myEffects })`.

### 3. Use it in a route

```elm
page : Request -> Loader (Document Never)
page _ =
    Loader.map renderDashboard dashboard
```

The route awaits ONCE; the three queries land together in one effect
response.

## Wall-clock contract

If the slowest query is `S` ms and the sum is `Σ`, sequential is `Σ`,
parallel is roughly `S + overhead`. The win grows with the number of
independent queries.

The reference app has a working demo at `/parallel` that emits three fake
queries (60 + 80 + 70 ms) inside one custom effect and reports the actual
wall-clock so you can see the difference yourself.
[examples/basic/src/Example/Basic/Routes/Parallel.elm](../../examples/basic/src/Example/Basic/Routes/Parallel.elm) +
the `parallelMarkets` branch in
[examples/basic/runtime.ts](../../examples/basic/runtime.ts).

## When NOT to use this

- **Single SQL with CTEs covers it** → use that instead. The query planner
  is more clever about joins, filters, and indexes than your hand-written
  fan-out.
- **Queries depend on each other** (`A → B` where B uses A's result) →
  `andThen`, not parallel. Promise.all only helps independent work.
- **Many small queries** → N+1 is still N+1. Batch with `IN (...)`, a
  window function, or a join, even if you fan it out.

## Failure semantics

`Promise.all` rejects as soon as any promise rejects, dropping the rest.
The custom effect should catch and return a clean `{ ok: false, error }` so
the loader sees a typed failure:

```ts
if (effect.kind === "parallelDashboard") {
  try {
    const [a, b, c] = await Promise.all([qA, qB, qC]);
    return { ok: true, value: combine(a, b, c) };
  } catch (error) {
    return { ok: false, error: `parallelDashboard failed: ${String(error)}` };
  }
}
```

For "give me whatever finished" semantics, use `Promise.allSettled` and
shape `value` to include per-query status.

## Source

- [packages/elm-ssr/elm-src/ElmSsr/Loader.elm](../../packages/elm-ssr/elm-src/ElmSsr/Loader.elm) — `Loader.custom`.
- [examples/basic/src/Example/Basic/Routes/Parallel.elm](../../examples/basic/src/Example/Basic/Routes/Parallel.elm) — full Elm side.
- [examples/basic/runtime.ts](../../examples/basic/runtime.ts) — `parallelMarkets` branch in `exampleEffects`.
- [test/parallel.test.ts](../../test/parallel.test.ts) — end-to-end + wall-clock proof.
