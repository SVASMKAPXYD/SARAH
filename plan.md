# SARAH — build plan (single source of truth)

SARAH is a simulated night search rover. **Gemini is the search-and-navigation brain.** The experiment asks whether a multimodal model can use aligned RGB, thermal, and hue-encoded depth, plus its own free-form written memory, to find a missing person and return to base. This is Bitter Lesson-inspired: keep local navigation rules small and give the model the raw observations and room to reason. SARAH does not train or scale a model.

## Core ownership

| Gemini decides | Local simulation does |
|---|---|
| Interpret RGB, thermal, depth, calibration, forest bounds/base, current pose, last action result, and its free-form memory. | Generate/render the hidden world and sensors; never send hidden survivor coordinates or truth labels. |
| Every absolute bearing and travel distance; search, backtrack, decide whether to mark, and return to base. | Execute the requested movement, enforce physical limits, and stop at simulated collisions. |
| What to preserve in its memory and when to replace that memory. | Include the current memory text in the next independent request; keep no hidden model conversation. |
| Whether an observation is enough to claim the survivor. | Record the mark and grade it against hidden truth after the run. |
| How to interpret raw field-team radio reports. | Keep up to 24 reports (500 characters each) verbatim and provide them as context; never parse them into navigation guidance. |

There is no local route planner, frontier selection, candidate ranking, evidence threshold, or automatic return. A graph is no longer Gemini's memory or an input to its decision. Local collision geometry is simulation physics, not navigation advice. The operator map shows the driven path and an always-visible hiker location marker for operator guidance; other hidden truth may be revealed for evaluation. None of this map data is sent to Gemini.

The `field_briefings` packet field contains the original operator-entered strings. Gemini alone interprets these reports alongside its sensors and memory. The simulator does not derive bearings, confidence weights, map focus regions, or movement adjustments from their text. Reports are sent in the next decision request; a report submitted while a request is already in flight does not alter that decision or its execution.

## Per-turn contract

`POST /api/decide` receives exactly three aligned 1024×768 images in fixed order—RGB JPEG, thermal JPEG, depth PNG—plus an `ObservationPacket` containing:

- world dimensions (180 m × 180 m), coordinate bounds (−90 m to +90 m on x and z), and base at `{x:0,z:0}`; coordinates are relative to base;
- current mission phase, step, remaining decision budget, and distance travelled;
- current position `{x,z}` in meters and compass heading in degrees;
- sensor calibration, including the depth encoding;
- the current free-form `memory` text (empty at mission start);
- `field_briefings`, the retained verbatim field-team reports (up to 24 strings, each up to 500 characters);
- the simulator's exact result for the previous movement.

Depth is encoded losslessly as PNG with fixed-saturation/value HSV color: hue increases from red (0°) at 0 m through yellow, green, and cyan to blue (240°) just below 35 m; no-return pixels and surfaces at or beyond 35 m are black. Distance is radial from the sensor camera origin. Do not send a second numeric depth grid, local collision advice, or hidden-world data.

The required response fields are `bearing_deg` (absolute compass bearing, north is 0°, clockwise, 0–360), `distance_m` (0–15; zero turns in place), `reason`, and `replace_entire_memory`. The last field is the entire new memory file, limited to 24,000 characters. Every decision overwrites the stored memory with exactly that string; it is never appended or merged. To preserve memory unchanged, return the complete existing text. An empty string intentionally clears it. `mark_survivor` may be set true to record a claim at the current rover position; marking does not move the rover. The system prompt explicitly recommends tracking three useful layers: overall search strategy for the forest, the immediate task being pursued now, and past visited path / actually searched areas with coordinates, observations, and uncertainty. It says to update path and coverage after each movement using current pose and the simulator's last-movement result, distinguishing traveled-through, searched, and unsearched areas. It also recommends preserving durable environmental/navigation learnings and unresolved leads. These are memory suggestions, not a rigid format. Compress redundant wording without discarding useful history; transient pose, phase, budget, and last result are resent each turn and need not be duplicated.

**Statelessness is a contract:** every model request is created from scratch with only the system instruction, current three images, and current packet. Requests set `store: false` and never set a previous-interaction ID or cached context. The same model may be selected on consecutive turns without inheriting any conversation. Any schema-correction retry is another fresh request containing the same current observations and a short validation error, not prior model conversation. The explicitly returned memory text is the only model-authored information carried across decisions; mission reset clears it.

**Coordinates:** meters; x east, z south; heading 0° north/−z and clockwise positive. RGB, thermal, and depth share the front-mounted sensor camera pose, 0.7 m ahead of rover center, and 90° horizontal FOV. All sensor captures are 1024×768; RGB and thermal use JPEG at 90% quality while depth is lossless PNG. RGB sensor pass applies the night visibility lift; headlamp targets near-level with 30 m range. Depth is 0–35 m; black means no return or distance at/over 35 m. Sensor triplets refresh periodically at 0.5 Hz; before a decision, a one-shot capture is requested when the current frame does not match the rover pose/world version.

## Mission and simulation behavior

Gemini chooses every movement, including all return-to-base movement. The simulator clamps distance to 15 m, executes absolute bearing as a relative physical turn, and stops at obstacles. A true `mark_survivor` records the current position without a local evidence gate; the next decision sees the extraction phase. Returning to base after a mark completes the mission. Hidden-truth grading decides whether the mark was correct. No automatic move or route to base is created locally.

Terrain generation remains a separate operator feature: `/api/terrain` maps operator text to procedural `TerrainParams`. `slope` and `bumpiness` are currently fixed at zero. The overhead map's truth marker is operator-only and never enters Gemini inputs.

## Gemini model selection and failure policy

Try the Flash-Lite preference in order: `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-2.5-flash-lite`. No `GEMINI_MODEL` override. Each model gets one initial request and at most one schema-correction request; model-specific unavailability/quota advances to the next preference. A 404 marks that model unavailable for this server process, avoiding repeated calls; restart the server to retry discovery. There are at most six model requests per decision.

Advance only for model-unavailable (404), temporary model service unavailability (503), or a 429 whose error identifies a per-model quota. Stop and surface auth, malformed request/schema, billing, project-wide quota, unknown 429, and network failures. Flash-Lite preference does not guarantee free access or evade project limits. `/api/health` reports configuration/preferences, not verified runtime availability. Actual selected model, latency, and token usage appear in the UI and replay.

## Operator experience

Show the selected absolute bearing, distance, brief reason, exact simulator result, and the current memory text in the Agent panel. The operator-side Reasoning stream shows optional model-provided summaries, concise observation-focused decision rationales, and simulator feedback without duplicating movement coordinates; it is a timeline across independent turns, not context supplied to Gemini. Model summaries are not a full private chain-of-thought transcript. The Memory tab shows the full persistent text. Metrics show model, latency, tokens, distance, and memory length.

Default to an immersive third-person rover view, with icon toggles for first/third person and RGB → thermal → depth, a resizable overhead operator map, and a layout toggle for the classic split view. First-person mode displays the aligned capture used by Gemini; third-person RGB/thermal remain live chase-camera renders, and third-person depth is a live hue-coded chase-camera render. Both overhead maps show the driven path, rover, mark, and an always-visible red hiker marker with expanding pulse rings; other hidden truth can be revealed for evaluation. The operator map is not the model's graph or memory.

## Current implementation map

- `src/lib/gemini/modelRouting.ts`, `client.ts`, `interactionRequest.ts`: model preference/failure policy and fresh, unstored Gemini requests with no continuation ID.
- `src/lib/gemini/prompt.ts`, `schema.ts`, `mock.ts`: concise brain instruction, minimal movement/memory response, and offline fixture.
- `src/lib/types.ts`, `src/lib/sim/packetBuilder.ts`, `src/lib/sim/depth.ts`: current observation, memory, decision, replay, and depth calibration contracts.
- `src/lib/sim/executor.ts`, `missionLoop.ts`, `grading.ts`: physical movement/collision, memory replacement, optional mark, return completion, and hidden-truth scoring.
- `src/components/world/SensorRig.tsx`, `src/lib/sim/collisions.ts`, `src/lib/world/`: aligned sensor capture, private collision-stop physics, and world simulation.
- `src/store/missionStore.ts`, `src/components/panels/`, `src/components/world/GraphOverlay.tsx`: run-scoped memory, operator trace/metrics, and path-only overhead view.
- `src/app/api/decide/route.ts`, `api/health/route.ts`, `api/terrain/route.ts`: server endpoints. `src/lib/sim/replay.ts` records decisions and memory replacements for network-free playback.
- `README.md` and `deployment.md`: setup and operation. `multimodal_sar_agent_architecture.md` points to this plan rather than defining competing behavior.

## Status and limits

Implemented: seeded world; explicit 180 m × 180 m bounds/base in every decision packet; aligned RGB/thermal/per-pixel depth rendering; depth calibration and PNG transport; front-mounted camera; 0.5 Hz capture cadence with pose-matched one-shot capture; third-person live depth; brighter RGB/headlamp; high-resolution sensor inputs; Flash-Lite model fallback; minimal bearing/distance/reason output; optional mark and required full free-form memory replacement with overwrite semantics; empty memory on reset; `store: false` and no prior interaction ID; current replay format plus version-1 and version-2 replay migration; operator path view, model/latency/token metrics, and hidden-truth grading.

Still unverified: live end-to-end search → mark → Gemini-directed return for a fixed seed; terrain generation over varied seeds and decoys; actual availability/quota/free-tier status for each model. A live API key and project quota are required for those checks.

Known simulator limits: local collision stopping uses a 2D geometric approximation and is not a camera-aligned depth measurement; terrain slope and animal/world interactions are simplified. Validate depth pixels against known rendered geometry before claiming accurate ranging. Do not add local navigation heuristics to hide these limitations.

## Acceptance checks

1. Focused tests, type-check, and production build pass.
2. Every decision request carries exactly three aligned images and the current packet, with no map/graph, numeric LiDAR grid, local collision advice, hidden truth, previous interaction ID, or retained context; requests set `store: false`.
3. Response schema requires bearing, distance, reason, and complete memory replacement; optional mark is validated. Movement remains physically bounded and collision-stopped.
4. The required `replace_entire_memory` field is written as the entire memory on every turn. It is not appended or merged, is bounded at 24,000 characters, and clears only on intentional empty replacement or mission reset.
5. A mark reaches grading without an assessment/count/range gate. Gemini directs all return movement; reaching base after a mark completes extraction.
6. Replay, mock, manual mode, operator panels, and docs use the same minimal decision contract.
7. Live smoke and fixed-seed mission remain reported as unverified until run with the configured API project and observed quota.
