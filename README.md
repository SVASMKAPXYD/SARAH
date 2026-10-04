# SARAH — Search And Rescue Autonomous Helper

SARAH is a simulated night-forest search rover. Gemini reads aligned RGB, thermal, and per-pixel hue-encoded depth images, the 180 m × 180 m forest bounds centered on base, its current pose, the last movement result, and one free-form memory text. It chooses each absolute compass bearing and travel distance, gives a brief reason, and returns `replace_entire_memory` on every turn. That field overwrites the entire stored memory; it is never treated as an append or patch. The prompt explicitly recommends preserving an overall search strategy, the current immediate task, and the past visited path/search coverage with coordinates, observations, and confidence, as well as unresolved leads. Memory replacements are capped at 24,000 characters. Every request is stateless: Gemini receives no prior conversation or retained context, even when consecutive turns use the same model. Local code simulates the world, executes movement with private collision physics, and grades survivor marks against hidden truth; it does not plan routes or gate marks.

The operator can cycle the sensor preview through RGB, thermal, and depth. These aligned views share the front-mounted sensor camera; its lens sits 0.7 m ahead of the rover center to clear the rover body. Captures are 1024×768 (2× the prior width and height); RGB and thermal use 90%-quality JPEG, while depth is lossless PNG. Sensor frames refresh at 0.5 Hz, with an immediate capture when a decision needs a frame matching the rover's current pose. The decision API uses the latest RGB/thermal/depth triplet that matches the current world and rover pose. Depth hue sweeps from red at 0 m through yellow, green, and cyan to blue just below 35 m; black means no return or 35 m and farther. In third-person mode, depth is rendered live from the chase camera rather than from the rover sensor. Collision stopping remains local simulation physics; no old coarse LiDAR grid or image overlay is sent to Gemini.

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

The Agent panel shows the chosen bearing, distance, reason, memory, and exact simulator result. The Reasoning stream presents chronological model-provided summaries when available, concise observation-focused rationales, and simulator feedback without repeating bearing/distance details. It is an operator-side timeline across fresh independent turns, not context passed back to the model. Model summaries are optional and are not a full private chain-of-thought transcript. The Memory tab displays the complete persistent text. Metrics show the selected model, latency, and tokens.

Decisions (including complete memory replacements) are recorded for replay without network calls. Use **Save replay**, put the JSON under `public/replays/<name>.json`, then open `/?replay=<name>`. Existing version-1 and version-2 replay logs are converted to the current format when loaded.

## Source of truth

- [`plan.md`](./plan.md) is the sole architecture and implementation plan, with contracts, responsibilities, model failure behavior, status, and acceptance checks.
- [`multimodal_sar_agent_architecture.md`](./multimodal_sar_agent_architecture.md) points to that plan; it is not a competing specification.
- [`deployment.md`](./deployment.md) covers live Gemini and Azure setup.

Useful checks: `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
