# SARAH — Search And Rescue Autonomous Helper

SARAH is a simulated night-forest search rover. Gemini reads aligned RGB and thermal images, LiDAR, and its own topological graph memory; it authors map updates and chooses every turn and movement, including backtracking and return. Local code simulates the world, stores graph data, executes motion with collision physics, and grades against hidden truth. It does not plan routes or gate survivor marks.

## Setup

Use Node.js 24 LTS (Next.js 16 requires Node.js 20.9 or newer).

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 and press **Run**. With no key, SARAH uses a simple deterministic offline fixture; this is not Gemini and does not demonstrate autonomous rescue. For live use, place the API key in `.env.local`, leave `DECIDER` unset, and verify current project/model quota before running a mission. The API key stays server-side.

## Configuration

| Variable | Meaning |
|---|---|
| `GEMINI_API_KEY` | Server-only Google AI Studio key. Never use a `NEXT_PUBLIC_` prefix. |
| `DECIDER` | Set to `mock` to force the offline fixture; otherwise a configured key enables Gemini. |
| `NEXT_PUBLIC_DEV_CONSOLE` | `1` shows the development-only manual decision console. |

The Flash-Lite preference and bounded model-specific fallback are in [`src/lib/gemini/modelRouting.ts`](./src/lib/gemini/modelRouting.ts) and [`src/lib/gemini/client.ts`](./src/lib/gemini/client.ts). No model environment override is used. This avoids switching to higher-cost model families, but Google account quota/billing terms still apply. A failed model preference does not bypass project-wide quota, billing, auth, or request errors.

## Operator view and replay

The agent panel and thought transcript show the structured observations, assessment/evidence, map update, intent, action, brief reason, and simulator result. The API may also return a thinking summary; that is optional and is not raw chain-of-thought. Metrics show the selected model, latency, and tokens.

Decisions are recorded for replay without network calls. Use **Save replay**, put the JSON under `public/replays/<name>.json`, then open `/?replay=<name>`. Older logs without model metadata remain readable.

## Source of truth

- [`plan.md`](./plan.md) is the sole architecture and implementation plan, with contracts, responsibilities, model failure behavior, status, and acceptance checks.
- [`multimodal_sar_agent_architecture.md`](./multimodal_sar_agent_architecture.md) points to that plan; it is not a competing specification.
- [`deployment.md`](./deployment.md) covers live Gemini and Azure setup.

Useful checks: `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
