# SARAH — build plan (single source of truth)

SARAH is a simulated night search rover. **Gemini is the search-and-navigation brain.** The test is whether a multimodal model can use aligned visible-light RGB, thermal, hue-encoded depth, and a small graph memory to explore, locate a missing person, choose when to mark, and navigate home—without a local planner or rescue-policy rules choosing for it. This is Bitter Lesson-inspired, not a claim that SARAH trains or scales a model.

## Core ownership

| Gemini decides | Local simulation does |
|---|---|
| Interpret aligned RGB, thermal, depth images, calibration, and prior graph memory together. | Generate/render the hidden world and sensors; never send hidden coordinates or truth labels. |
| What places/paths/frontiers mean; what to remember and annotate. | Store Gemini-declared graph data, assign stable-in-run IDs, and record the path actually driven. |
| Every turn, bearing, distance, exploration/backtrack choice, survivor assessment, mark, and return movement; perceive depth from the depth image. | Execute only the requested `MOVE` or `MARK_SURVIVOR`; apply physical turn/move bounds and stop at simulated collisions. |
| Whether evidence is enough and when to return. | Grade the final mark against hidden truth; report the result. |

There is no local shortest-path/Dijkstra planner, route recommendation, candidate ranking, evidence threshold, repeated-confirmation requirement, LiDAR rescue-range gate, or automatic return. The graph is memory, **not** a route command. Gemini must issue a fresh `MOVE` for every part of exploration and return. A mark records the rover's current position; it may be wrong, and hidden-truth grading says so. Sensor image triplets refresh periodically at 0.5 Hz; when a decision needs an image that no longer matches the rover pose/world version, a one-shot capture is requested before calling Gemini. The API is sent the latest RGB/thermal/depth triplet whose world version and pose match the current decision state.

## Per-turn contract

Input to `/api/decide`: exactly three aligned 512×384 images in fixed order—RGB JPEG, thermal JPEG, depth PNG—plus an `ObservationPacket` containing:

- mission phase, step/budget, distance travelled, and previous model assessment;
- pose `{x,z,heading_deg,at_node}` and image calibration, including depth encoding;
- graph nodes, actually traversed edges, and frontiers Gemini previously declared;
- the simulator's exact result for the last action.

Depth is encoded losslessly as PNG with fixed-saturation/value HSV color: hue increases from red (0°) at 0 m through yellow, green, and cyan to blue (240°) just below 35 m; no-return pixels and surfaces at or beyond 35 m are black. Distance is radial from the sensor camera origin. Do not send a second numeric depth grid or burn bearings/range labels into the images. Local collision geometry remains private simulation physics and is not supplied as navigation guidance.

The packet contains no route to base, planned polyline, hidden world, survivor coordinate, or locally inferred target. Output is a schema-checked `Decision`: observations, map update, survivor assessment/evidence, intent, action (`MOVE {turn_deg,distance_m}` or `MARK_SURVIVOR`), confidence, and one-sentence operator reason. Shape/range clamping is not a policy score: it bounds motion to −180°…180° and 0…15 m; collisions remain simulator physics.

**Coordinates:** meters; x east, z south; heading 0° north/−z and clockwise positive; turn positive means right. Absolute bearing = heading + turn. RGB, thermal, and depth share the front-mounted sensor camera pose, 0.7 m ahead of rover center, and 90° horizontal FOV. The RGB sensor pass applies the same night visibility lift as the live light view; headlamp beam targets near-level, with 30 m range. Depth range is 0–35 m with black at and beyond the limit; local collision stopping remains private simulator geometry.

## Graph memory contract

- `TopoNode`: store-assigned `id`, observed `x,z`, Gemini-declared `kind`, visited flag, optional note, last model assessment, and Gemini-reported thermal/RGB evidence scores. `BASE` is created locally; new declarations get `N1…`. Declarations within 1 m update an existing node.
- `TopoEdge`: store-assigned `id`, `from/to`, polyline of actual rover positions, measured length/bearing/clearance, traversal flag (`safe` in current type), and Gemini terrain/hazard annotation. New node declarations close an edge using the recorded trace; no edge implies a path is available.
- `Frontier`: store-assigned `id`, originating node, Gemini-provided absolute bearing/distance/geometry/status/note. New declarations get `F1…`; Gemini can update status. Current store does not merge duplicate frontiers or cap graph growth.
- The store performs bookkeeping only. It does not choose a frontier, rank nodes, route between nodes, or convert graph edges into motion.

## Gemini model selection and failure policy

Try the Flash-Lite preference in order: `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-2.5-flash-lite`. No `GEMINI_MODEL` override. Each model gets one initial request and at most one schema-correction request; model-specific unavailability/quota advances to the next preference. A 404 marks that model unavailable for this server process, avoiding repeated calls; restart the server to retry discovery. There are at most six model requests per decision, with no retry/backoff multiplication.

Advance only for a model-unavailable response (404) or temporary model service unavailability (503), or a 429 whose error identifies a per-model quota. Stop and surface auth, malformed request/schema, billing, project-wide quota, unknown 429, and network failures; trying another model cannot fix them. The preference list contains only Flash-Lite models, but does not guarantee free access or evade project limits. `/api/health` reports configuration/preferences, not verified runtime availability. Actual selected model, latency, and token usage appear in the UI and are saved to replay.

## Operator trace

Show the model's returned observations, evidence/assessment, graph update, declared intent, action, and brief reason, followed by the exact simulator result. Show the selected model, latency, and tokens. Display the API's optional thinking summary only when it returns one. Gemini does **not** expose guaranteed raw chain-of-thought; never fabricate or promise it. Default to an immersive third-person rover view, with single-button icon toggles for first/third person and RGB → thermal → depth, a small resizable square overhead minimap, and glowing thoughts/place-graph text over a transparent HUD. First-person mode displays the aligned RGB, thermal, or depth capture from the same sensor frame and perspective used by Gemini; third-person RGB/thermal remain live chase-camera renders, and third-person depth is a live hue-coded chase-camera render (not the rover sensor capture). Depth shows its red-to-blue 0–35 m legend, with black at and beyond 35 m or for no return; overlay/grid controls are removed. A layout toggle returns to the classic split view.

## Terrain generation and operator map

`/api/terrain` maps operator text to procedural `TerrainParams` through Gemini's structured output; the Terrain panel applies the returned parameters and regenerates the seeded world. `slope` and `bumpiness` are currently fixed at zero in defaults, schema normalization, model instructions, and generation state. The overhead map shows the ground-truth hiker as a red dot and rover as a white dot for operator orientation only; truth markers are not included in the rover's sensor frames or Gemini packet.

## Current implementation map

- `src/lib/gemini/modelRouting.ts`, `client.ts`: model preference/error classification and server-only Interactions API, failover, structured output, optional summary and usage.
- `src/lib/gemini/prompt.ts`, `schema.ts`, `mock.ts`: brain instructions, shared response contract, offline fixture.
- `src/lib/types.ts`, `src/lib/sim/packetBuilder.ts`, `src/lib/sim/depth.ts`: shared graph/packet/action/replay and depth-encoding contracts; packet exposes calibration and graph memory, not a computed route or numeric LiDAR grid.
- `src/lib/sim/mapStore.ts`: graph bookkeeping and evidence storage.
- `src/lib/sim/executor.ts`, `phase.ts`, `missionLoop.ts`: physical movement/collision, display phase, decision→map→action loop, mark recording and return completion.
- `src/components/world/SensorRig.tsx`: aligned RGB/thermal/depth capture; `src/lib/sim/collisions.ts`: private collision-stop/clearance physics, separate from the Gemini sensor contract; `src/lib/world/`: world simulation.
- `src/store/missionStore.ts`, `src/components/panels/`, `src/components/world/GraphOverlay.tsx`: operator state, model trace/metrics, graph view without a highlighted locally chosen route.
- `src/app/api/decide/route.ts`, `api/health/route.ts`, `api/terrain/route.ts`: server endpoints. `src/lib/sim/replay.ts` records decisions and selected model for network-free playback.
- `README.md` and `deployment.md`: setup and operation; this file is the design SSOT. `multimodal_sar_agent_architecture.md` points here rather than defining competing behavior.

## Status and proof still needed

Implemented: seeded world and aligned RGB/thermal/per-pixel depth rendering; depth calibration and PNG transport to Gemini; packet no longer contains numeric LiDAR grid; old grid/overlay renderer deleted; private collision stopping retained separately; RGB/thermal/depth UI cycling; graph storage/IDs/edge traces; Gemini structured client and explicitly non-visual mock; model-specific fallback; free MOVE + mark actions; no local route planning or mark gates; replay; thought/decision display, model/latency/token metrics; hidden-truth grading; Gemini-directed terrain generation; operator-only hiker/rover map markers. Hiker placement has a bounded-grid fallback when random placement fails.

One live terrain request returned structured parameters from `gemini-3.5-flash-lite` in 1.0 s. Not yet proven: a fixed-seed full search→mark→Gemini-directed return; terrain generation across decoys/seeds; availability/free-tier status of each preference. The optional API thinking summary may be absent.

Known simulator limits are experiments, not Gemini policies: local collision stopping still uses a 2D geometric approximation and is not a camera-aligned depth measurement; heightmap steep slopes and animal/world interactions are simplified; graph size/frontier duplication are unbounded. Validate depth pixels against known rendered geometry before claiming accurate ranging. Do not add local navigation heuristics to mask these limitations.

## Acceptance checks

1. Focused tests, type-check, lint, and production build pass. Decision and replay contracts accept only `MOVE`/`MARK_SURVIVOR`; older replay entries without model metadata still load and report packet divergence when sensor contracts differ.
2. Gemini request has exactly three aligned images in order (RGB JPEG, thermal JPEG, depth PNG), fixed calibration, graph memory, and no numeric LiDAR grid, local collision advice, or safe-return path.
3. Any legal `MARK_SURVIVOR` reaches grading without assessment/count/range gates. A `MOVE` into an obstacle stops physically and returns the observed collision result.
4. All return motion is Gemini `MOVE`; extraction completes only when the model has declared return and the simulated rover reaches base.
5. Fallback advances only on model-specific availability/quota conditions, makes no more than six calls, and surfaces project-wide/auth/request errors. A returned decision and replay record identify the actual model.
6. Operator UI cycles RGB/thermal/depth, exposes the red-to-blue hue distance scale, and has no old grid/overlay control. It shows the actual structured decision and simulator result; an absent thinking summary remains absent, not synthesized.
7. Live smoke and fixed-seed mission are explicitly reported as unverified until run with the user's configured API project and observed quota.
