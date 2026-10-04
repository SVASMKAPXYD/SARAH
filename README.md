# SARAH — Search And Rescue Autonomous Helper

A 24-hour hackathon project (GirlHacks 2026). A small rescue rover is dropped at a trailhead in a
procedurally generated night forest with no map, a headlamp, an RGB camera, a thermal camera and a
short-range LiDAR. **Gemini is the whole agent**: after every move it receives the two images and a
compact observation packet, interprets them jointly, **authors the topological map** (nodes,
frontiers, edge annotations, evidence) and **commands every heading change and move**. Deterministic
local code only renders the world, simulates sensors and physics, stores the map Gemini declares,
follows routes the rover has already driven (`GOTO_NODE`, `EXTRACT`) and grades the result against
ground truth Gemini never sees.

Design docs: [`plan.md`](./plan.md) (build plan, source of truth), [`fable.md`](./fable.md) (notes),
[`multimodal_sar_agent_architecture.md`](./multimodal_sar_agent_architecture.md) (original spec).

## Quick start

```bash
npm install
cp .env.example .env.local      # optional; without a key the app runs in mock mode
npm run dev                     # http://localhost:3000
```

Press **Run**. With no `GEMINI_API_KEY` the server answers `/api/decide` with a deterministic
**mock decider** (steers toward the clearest LiDAR column, declares nodes/frontiers, backtracks with
`GOTO_NODE`). The rover drives in the 3D view, the agent panel shows each decision, the minimap shows
the map being built, and the mission ends when the 40-decision budget is exhausted (the mock never
marks a survivor — use the manual console for that).

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npx tsc --noEmit`.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `GEMINI_API_KEY` | Server-only key. Never prefix with `NEXT_PUBLIC_`; the browser never calls Gemini. |
| `GEMINI_MODEL` | Model id, default `gemini-3.8-flash`. |
| `DECIDER` | `mock` forces the mock decider even when a key is present. Mock is also automatic when the key is missing or `?mock=1` is passed to the API. |
| `NEXT_PUBLIC_DEV_CONSOLE` | `1` shows the manual decision console (also `?dev=1` in the URL or the "Dev console" toggle). |

## Mock vs live

- **Mock** (`GEMINI_API_KEY` empty or `DECIDER=mock`): `/api/decide` and `/api/terrain` return
  deterministic results computed from the packet / prompt alone. Zero network. The Controls badge
  shows `mock`.
- **Live** (key set): `/api/decide` calls Gemini through `@google/genai` with the two overlay images,
  the packet JSON, structured output (`DecisionSchema`), `thinking_level: low`, thought summaries and
  low media resolution. 429/5xx → exponential backoff (UI shows "waiting for Gemini"); unparseable
  output → one retry with the zod error appended. The badge shows `LIVE · gemini`, and latency/tokens
  appear in the metrics strip.

## Manual decision console (dev)

Enable with `NEXT_PUBLIC_DEV_CONSOLE=1`, `?dev=1`, or the "Dev console" toggle. Set the decider to
**manual console** and press Run: after every action the loop waits for you. Paste or build a
Decision JSON (presets: MOVE, turn, node + frontier, GOTO BASE, CONFIRMED, MARK_SURVIVOR,
RETURN_TO_BASE) and submit — the same schema Gemini returns, through the same executor and protocol
rules (MARK needs CONFIRMED_CANDIDATE twice within 2 m; RETURN_TO_BASE only after RESCUE).

## Replay

Every decision is recorded as `{ seed, step, packetHash, decision, thought, latencyMs }`.
**Save replay** in Controls downloads the current run. Put a log in `public/replays/<name>.json`
and open `/?replay=<name>` to regenerate the recorded seed/params and drive the executor from the
log with no network (a recording, not a decision-maker). `public/replays/demo.json` is a valid
one-entry example.

## Folder map (by track, plan §5)

```
src/
  lib/
    types.ts, constants.ts, geo.ts            shared contract: spec types, frame conventions, constants
    gemini/                                   P2 brain
      schema.ts        zod DecisionSchema / TerrainParamsSchema + JSON schema for response_format
      prompt.ts        permanent instruction ({budget} templated) + terrain instruction
      client.ts        server-only @google/genai client (Interactions API, backoff, parse retry)
      mock.ts          deterministic mock decider + keyword terrain mock
    world/                                    P1 world
      terrain.ts       seeded generator: heightmap, trails, trees, logs, rocks, water, fungi,
                       survivor (≥40 m, off trail), fox/deer — `truth` never leaves the browser
      animals.ts       fox wander/flee, deer stand/bolt
    sim/
      sensors.ts       P1 LiDAR 9×2 grid (2D ray approximation) + collision clearance
      overlay.ts       P1 burned-in bearing/distance overlay → base64 JPEG for Gemini
      mapStore.ts      P3 Gemini-authored map: BASE, declareNode + edge recording, frontiers, evidence
      dijkstra.ts      P3 safe-edge Dijkstra (GOTO_NODE / EXTRACT only)
      executor.ts      P3 MOVE / GOTO_NODE / MARK_SURVIVOR / RETURN_TO_BASE, verbatim last_result
      phase.ts         P3 phase from intent (SEARCH → … → COMPLETE)
      packetBuilder.ts P2/P3 ObservationPacket (bearing_from_rover_deg, safe_return_path, …)
      grading.ts       P3 mark vs ground truth, distance error, leads investigated
      replay.ts        P3 recorder / player / loader
      missionLoop.ts   P3 MissionController: the loop (sensors → packet → decide → apply → execute)
  store/missionStore.ts                       Zustand mission store (sim fields) + UI store
  hooks/useMission.ts                         React entry to the controller, URL flags
  components/
    world/Scene.tsx        P1 R3F forest, rover + headlamp, truth meshes on layer 1, follow camera
    world/SensorRig.tsx    P1 offscreen RGB + thermal passes (512×384, 90° HFOV) → store.frame
    world/GraphOverlay.tsx P1/P4 SVG minimap of Gemini's map (+ truth when revealed)
    panels/                P4 AgentPanel, MetricsStrip, RoverPanel, Controls, TerrainChat,
                           ManualConsole, ResultCard
    ui/                    Button, Card, Badge, Tabs, Toggle
  app/
    page.tsx, layout.tsx, globals.css         P4 layout (plan §2)
    api/decide/route.ts                       P2 POST { packet, rgb, thermal } → Decision
    api/terrain/route.ts                      P2 POST { prompt } → TerrainParams
    api/health/route.ts                       GET → { ok, decider, model, budget }
public/replays/demo.json                      example replay log
```

## Conventions

Meters; x east, z south (Three.js +z); heading 0° = north (−z), clockwise positive;
`bearingTo(p) = atan2(dx, −dz)`; `turn_deg` positive = right; absolute bearing = heading + turn.
LiDAR columns are keyed by relative bearing (`-40 … 40`, 10° each) over the camera's 90° FOV, so a
column key is literally the `turn_deg` that points at it. See `src/lib/constants.ts`.

## Known stubs (`TODO(P1..P4)` markers)

- P1: LiDAR is a 2D ray-vs-circle approximation over the obstacle list (no Three.js raycasts, no
  STEEP_SLOPE from the heightmap); animals ignore obstacles; the sensor rig renders at 1 Hz even while
  idle.
- P2: Interactions API field names in `client.ts` are typed against `@google/genai` 2.27 but have not
  been exercised against a live key (`TODO(P2): verify against ai.google.dev`).
- Stretch items from plan §1 (Tiger Data telemetry, Azure deploy) are not started.
