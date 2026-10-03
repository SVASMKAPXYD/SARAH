# SARAH — 24-hour build plan (GirlHacks 2026)

**SARAH = Search And Rescue Autonomous Helper.** Sources of truth: the team brief (`internal/girlhacks-project-sarah.docx`) for the idea and prizes, and `multimodal_sar_agent_architecture.md` (the spec) for the agent design and data types. Team facts (2026-10-03): 4 people, no physical camera, 1 snapshot per second from a procedurally generated forest, and the loop terrain → snapshot (RGB + thermal + LiDAR) → Gemini → decision → rover moves in the sim → next snapshot.

**Core rule.** Gemini is the autonomous search agent. It interprets the aligned RGB, thermal and LiDAR observation, **authors the topological map** (nodes, frontiers, edge annotations, evidence), and **commands every heading change and move**. Deterministic local code owns only world truth: rendering, sensor simulation, physics (the rover stops at obstacles), bookkeeping of the map Gemini declares, polyline following over edges the rover has already driven (`GOTO_NODE`, EXTRACT), and grading against ground truth Gemini never sees. There is no local planner, candidate scorer, evidence detector or autopilot. If Gemini gets lost or marks a deer, the mission fails and the UI says so; that is the experiment.

**Deviations from the spec**, deliberate: mapping and candidate generation move from local code (spec §3–§4, §7) to Gemini; `choice_id` from a supplied list (spec §9) becomes a free `action` (turn + distance, or a known node); LiDAR covers exactly the camera's field of view (spec §5 "±60°" becomes "= camera FOV"); the local confirmation detector (spec §7 CONFIRM) is replaced by Gemini's own evidence judgments, with persistence checked against Gemini's previous answers. Spec data types (`TopoNode`, `TopoEdge`, `Frontier`), phases, intents, assessments, packet shape and build order are kept.

Gemini facts were checked against ai.google.dev on 2026-10-03. Google no longer publishes free-tier request limits; those numbers are flagged as unofficial.

---

## 1. Pitch and prizes

**Pitch.** A hiker has not come back and it is dark. SARAH, a small rescue rover, is dropped at a trailhead with no map, a headlamp, an RGB camera, a thermal camera and a short-range LiDAR, all looking the same way. Every second it records what its sensors see. After every move it hands Gemini the two images and a compact text packet (LiDAR distances per image column, pose, the map Gemini itself has built so far, what the last move did) and Gemini answers with what it sees, how the map should be updated, how strongly the evidence points to a person, and the next move: turn this many degrees, drive this far, or go back to a known node. The forest contains real distractors a thermal camera would see at night: a fox, a deer, and bioluminescent fungi that glow on camera but are cold. Judges watch Gemini build a map from nothing, chase and dismiss animal signatures with camera + thermal together, confirm the person, and drive back along the route it mapped. The forest itself is generated from a sentence, also by Gemini.

| Prize (from the brief) | How SARAH earns it |
| --- | --- |
| **Best use of Gemini API** (primary) | Gemini is the whole agent: joint RGB + thermal + LiDAR interpretation, structured-output map authoring and motion commands, survivor assessment with calibrated confidence, visible reasoning in the feed, plus natural-language terrain generation. Honest claim (§3f). |
| **Theme** | A moonlit, fog-bound forest with glowing fungi is the setting, not a game: the mission, sensors and failure modes are those of a real night search. |
| **Best use of Tiger Data** (stretch) | Every 1 Hz observation and every decision is a time-series row (pose, phase, assessment, confidence, latency, tokens). Hypertable + continuous aggregate feed the metrics panel. |
| **Best use of Azure** (stretch) | Deploy the Next.js app to Azure App Service; demo runs locally; Azure is the public URL on Devpost. |
| **GoDaddy funny domain** (10 min) | Joke domain pointing at the Azure deployment (§7). |

Priority if time runs out: Gemini agent + sim, then Tiger Data, then Azure, domain whenever someone has 10 spare minutes.

---

## 2. Scope and demo storyboard

### In (must ship)

- **Procedural low-poly night forest** (seeded): heightmap, trees, fallen logs, a creek or pond, fog, moonlight, rover headlamp (~15 m useful RGB range; thermal is unaffected by darkness, which is why it matters), a **base** at the trailhead, several branching trails and dead ends.
- **Rover + sensors at 1 Hz**, one shared camera pose: RGB render, aligned thermal render, LiDAR grid over the same FOV, pose. Snapshots feed the UI and telemetry; the two images + packet captured at the end of each action go to Gemini.
- **Survivor**: one seated, stationary person (large steady human-shaped thermal signature; jacket with reflective strips in RGB), placed ≥40 m from base, off the main trail, not visible from base.
- **Decoys**: fox (small signature, wanders at ~1 m/s, flees inside 6 m), deer (large signature, stands still, bolts inside 8 m and stops ~20 m away), bioluminescent mushroom cluster (bright in RGB, cold in thermal). Counts set by terrain params.
- **Gemini-authored topometric map** (spec §4 types): Gemini declares nodes, frontiers and edge annotations; local code stores them and records edge polylines from actual motion.
- **Mission phases** (spec §7) SEARCH → INVESTIGATE → CONFIRM → RESCUE → EXTRACT → COMPLETE, derived from Gemini's declared intent; EXTRACT follows the stored graph back to base with no further Gemini calls.
- **Decision loop**: one Gemini call per action; cap 40 decisions per mission (budget shown to Gemini; exceeding it = mission failed).
- **Grading**: at mission end the UI reveals ground truth (survivor, animals, true trails) over Gemini's map and reports correct/false mark, distance error, decisions used, leads investigated.
- **UI** (spec §11): third-person view with Gemini's graph overlaid (big) + RGB/thermal rover panel (mini, swappable), thermal/light toggle, agent panel (phase, observations, map update, action, assessment, confidence, one-line reason, feed), metrics strip, Run / Pause / Regenerate / Reset, reveal-truth toggle after completion.
- **Terrain chat**: natural language → Gemini → `TerrainParams` → regenerate; advanced tab; seed field.
- **Replay**: recorded log of a real Gemini run on the demo seed; zero network. Not a decision-maker, a recording.
- **Manual decision console** (dev only): a form that submits the same action JSON Gemini would, so P1/P3/P4 can drive the loop before `/api/decide` works. Hidden in the demo build.

### Out

Real camera/drone input, AI-generated camera frames, multiple rovers, dense occupancy grid, any local path planner or heuristic fallback, Live API voice, accounts, saving worlds, mobile polish, high-fidelity art, learning of any kind.

### Demo-day storyboard (~3 minutes)

| Time | What judges see | The point |
| --- | --- | --- |
| 0:00 | Dark forest, fog, moon, rover headlamp at the trailhead. "A hiker didn't come back. SARAH has no map." | Realistic setting. |
| 0:15 | Terrain chat: *"denser pines, a creek on the east side, light fog."* World regenerates. | Gemini built the level from a sentence. |
| 0:30 | **Run**. Agent panel: *"Trail continues ahead ~12 m, dense trees left, gap right at +30°. No heat."* Map: node BASE, two frontiers. Action: `MOVE turn 0°, 10 m`. | Gemini is mapping and driving. |
| 1:00 | Thermal toggle. *"Small warm signature at +20°, moved ~2 m since the last observation; fox-sized. Animal, not a person."* Frontier marked, back to SEARCH. | Rejected a decoy with two modalities + motion. |
| 1:40 | Second lead: *"Large signature at −10°, 9 m. Shape is quadruped; it moved away when I approached."* `INVESTIGATE` → dismissed. | The hard decoy. |
| 2:10 | *"Steady human-shaped signature seated against a log, reflective strips in RGB, 3 m. CONFIRMED_CANDIDATE, second observation."* `MARK_SURVIVOR`. Result card: correct, 1.4 m from truth. | Payoff. |
| 2:40 | EXTRACT: return route lights up on Gemini's graph; rover drives home with no Gemini calls. Metrics. Reveal-truth toggle shows the map Gemini built against the real trails. | It knows the way home; the map was real. |

Rehearse on a fixed seed. Gemini is nondeterministic, so also record a replay of a good run for the backup.

---

## 3. Architecture

### 3a. Components

```
Browser (Next.js + React Three Fiber)
  Three.js world ── seeded terrain, trees, logs, water, base, survivor, animals (AI-wander/flee),
                    fungi; ground truth; raycast truth; hidden from Gemini
  Sensors @ 1 Hz ── one camera pose: RGB JPEG + aligned THERMAL JPEG (offscreen targets) +
                    LiDAR grid over the same FOV + pose; ring buffer for UI/telemetry
  Map store ── TopoNode / TopoEdge / Frontier exactly as Gemini declares them; edge polylines,
               lengths, clearances recorded from actual motion; Dijkstra over safe edges
               (used only for GOTO_NODE and EXTRACT)
  Executor ── MOVE (turn, drive, stop at obstacles), GOTO_NODE / EXTRACT (follow stored
              polylines), MARK_SURVIVOR; reports last_result verbatim
  Decision scheduler ── after every action: POST /api/decide { packet, rgb, thermal }
          │
          ▼
  Next.js Route Handler (server; GEMINI_API_KEY)
    @google/genai interactions.create({ model: gemini-3.8-flash,
      input: [rgb image, thermal image, packet JSON as text],
      response_format: DecisionSchema,
      generation_config: { thinking_level: "low", thinking_summaries: "auto", media_resolution: "low" } })
    zod-parse (shape only) → { decision, thoughtSummary, latencyMs, tokens }   (stretch: INSERT → Tiger Data)
          │
          ▼
  Apply ── map_update → map store; action → executor; phase derived from intent
  UI ── third-person + graph overlay, RGB/thermal panels, agent panel/feed, metrics, reveal-truth
```

### 3b. World, rover state, executor

- **Frame and conventions** (stated verbatim in the prompt and used everywhere): units meters; x east, z south (Three.js +z); heading 0° = north (−z), clockwise positive, so 90° = east; `bearing_to(p) = atan2(dx, −dz)`; `turn_deg` positive = clockwise/right; absolute bearing of a relative direction = `heading + turn`.
- `RoverState { x, z, headingDeg, phase, currentNode | null, step, decisionsUsed }`. Speed 4 m/s, turn rate 180°/s, LiDAR max 30 m, headlamp ~15 m, rescue range 2 m, max 15 m per `MOVE`.
- **`MOVE { turn_deg, distance_m }`**: rotate in place, then drive straight with per-frame collision rays; stop 0.5 m before trees/logs/rocks, at shorelines, and at slopes > 35°. `last_result` reports what actually happened: `"MOVED 10.0 m, heading now 72°"` or `"BLOCKED by FALLEN_LOG after 3.4 m, heading 72°"`. `distance_m: 0` is a pure turn (how Gemini looks around at a junction, since the LiDAR only covers the camera FOV).
- **`GOTO_NODE { node_id }`**: Dijkstra over `safe` edges (cost = length + hazard_cost from Gemini's annotation) from the current node; if the rover is mid-edge (e.g. after BLOCKED) it first retraces its own partial polyline to the last node. Executes with no Gemini calls, then queries Gemini on arrival.
- **`MARK_SURVIVOR`**: accepted if Gemini's own `survivor_assessment` was `CONFIRMED_CANDIDATE` on this and the previous observation and the center LiDAR column reads ≤ rescue range; otherwise rejected with the reason in `last_result` and Gemini decides again. The sim then records whether the actual survivor is within 3 m (correct) or not (false positive, mission failed). Either way phase → RESCUE.
- **`RETURN_TO_BASE`**: allowed only after RESCUE (spec §9); EXTRACT = Dijkstra to BASE over safe edges, no Gemini calls; COMPLETE at base.
- **Nothing else says no to Gemini.** Physics, the two protocol rules above, and schema shape are the only checks. No candidate list, no local score, no retry-with-heuristic.
- **Edge recording**: when Gemini declares a node, the store closes an edge from the previous node: `polyline` = actual positions driven, `lengthM`, `bearingDeg`, `minClearanceM` from the 1 Hz rays, `safe = true` (it was driven), `terrain`/`hazardCost` from Gemini's `edge_annotation`. Blocked moves do not create edges unless Gemini declares a `DEAD_END` node there.
- **Replay recorder**: each decision appends `{ seed, step, packetHash, decision, thought, latencyMs }`; `?replay=<file>` drives the executor from the log.

### 3c. Sensors and the image ↔ world bridge

Gemini has no innate knowledge of our camera: a pixel column is not a bearing and a pixel row is not a distance unless we make the correspondence explicit. The bridge is a **single camera model shared by all three sensors, exposed to Gemini three ways**:

1. **LiDAR grid aligned to the image.** Camera horizontal FOV 90°. LiDAR = 9 columns × 2 rows over the same 90°: columns are 10° sectors keyed by their relative bearing (`-40 … +40`), each the minimum of 3 rays; rows are `level` (horizontal at 0.6 m, catches trees/trunks/rocks) and `ground` (pitched −15°, catches low logs, water, drop-offs). Each cell = `{ m: distance | null (>30 m), hit: CLEAR | TREE | FALLEN_LOG | ROCK | WATER | STEEP_SLOPE | GROUND }`. Because the keys are relative bearings, **`turn_deg = column key` points the rover at that column**, and column *k* of the grid is image strip *k*; the prompt says so.
2. **Burned-in overlay on the images Gemini receives** (not the UI copies): 9 vertical dividers with their bearing labels along the top, the `level` distance for each column along the bottom, a 1-px horizon line, and ground-distance ticks at 2 / 5 / 10 m projected onto the ground plane with the known camera. A few canvas 2D calls after readback; it removes any need for Gemini to do intrinsics math.
3. **Closed-loop odometry in text.** `pose` and `last_result` state exactly what a command did in world units ("turned +30°, moved 7.2 m"), so Gemini can calibrate its sense of scale against outcomes, and every known node in the packet carries precomputed `bearing_from_rover_deg` and `distance_m` so map-relative reasoning needs no trigonometry.

Stretch, if Gemini misjudges where things are: ask it to also return the target's image position in Gemini's normalized 0–1000 image coordinates and unproject that pixel through the camera (raycast against terrain) to a world bearing/point for the UI overlay; or render Gemini's own graph top-down (rover arrow + FOV wedge, no world truth) as a third image.

| Input | Encoding |
| --- | --- |
| **RGB** | 1 JPEG 512×384 with the overlay, `media_resolution: low` (~66–258 tokens). |
| **Thermal** | 1 aligned false-color JPEG (same camera pose, second material pass; per-object temperature: person 1.0, deer 0.9, fox 0.8, rock 0.25, ground 0.1, water 0.05, fungi 0.1), same overlay. |
| **LiDAR** | `lidar` grid as above, ~80 tokens. |
| **Map** | Full Gemini-authored graph: nodes (id, x, z, kind, visited, note, last assessment, `bearing_from_rover_deg`, `distance_m`), edges (id, from, to, length_m, bearing_deg, safe, terrain, hazard_cost), frontiers (id, from_node, bearing_deg, estimated_distance_m, geometry, status, note). ≤ 50 nodes ≈ 1–2k tokens. |
| **Mission** | phase, step, `decisions_remaining`, distance traveled, `safe_return_path` (Dijkstra to BASE), `last_result`, previous `survivor_assessment`. |

### 3d. Gemini-authored map (spec §4 types, Gemini decides)

- **Nodes**: Gemini sets `node_here: { kind, note }` when the spec §4.2 criteria hold (junction, dead end, major turn, viewpoint, evidence, survivor); the store assigns the id and pose. BASE is created at start by the store. Not every meter.
- **Frontiers**: Gemini lists `new_frontiers` (absolute `bearing_deg`, `estimated_distance_m`, `geometry`, `note`) from what it sees; status changes (`TRAVERSED`, `BLOCKED`) come back as `frontier_updates`.
- **Evidence**: Gemini's `evidence { thermal, rgb_person, bearing_deg }` and `survivor_assessment` are attached to the current node as `thermalScore`, `rgbPersonScore`, `evidenceFrames` (count of consecutive observations ≥ LIKELY). No local detector.
- **Edges**: recorded from motion (3b); Gemini annotates terrain and hazard cost.

### 3e. Phases (spec §7, derived from Gemini's intent)

SEARCH (default; `EXPLORE_FRONTIER`, `FOLLOW_KNOWN_ROUTE`) → INVESTIGATE (`INVESTIGATE_THERMAL_LEAD`, `SCAN` with assessment ≥ POSSIBLE) → CONFIRM (`APPROACH_CANDIDATE`) → RESCUE (accepted `MARK_SURVIVOR`) → EXTRACT (`RETURN_TO_BASE`) → COMPLETE (at base). False lead: Gemini returns to SEARCH by intent. The multimodal confirmation principle (thermal alone is a lead, never a confirmation; signature must be large, steady, human-shaped and persist across observations) lives in the prompt and in the two-observation rule of `MARK_SURVIVOR`.

### 3f. Stack and Gemini usage

- **Next.js (App Router) + React + TypeScript**; **Three.js + @react-three/fiber + @react-three/drei** (`useFBO` render targets); **@google/genai** server-side via the **Interactions API**; **zod**; **Tailwind + shadcn/ui**. Optional: `pg` + Tiger Data, Azure App Service.
- **Model:** `gemini-3.8-flash` (stable; structured outputs; thinking levels). Model id in an env var. Start `thinking_level: "low"`; try `"medium"` at T+8–12 if INVESTIGATE/CONFIRM decisions are weak and latency allows.
- **Gemini features used:** multimodal image input (inline), structured output (`response_format` JSON schema) for decisions and `TerrainParams`, `thinking_summaries: "auto"` for the feed (summaries may be empty, so `brief_reason` + `observations` are the guaranteed text). Not used: Live API, `previous_interaction_id` (map state is sent in full every call; never rely on context history for geometry, spec §12).
- **Errors:** 429/5xx → exponential backoff and retry the same request; the mission visibly pauses ("waiting for Gemini"). Unparseable output → one retry with the parse error appended. No local decision is ever substituted.
- **Honest claim:** "Gemini interprets aligned rover RGB, thermal and LiDAR observations, builds and maintains a sparse topological map, and commands every heading change and move in a partially observable simulated search. Deterministic code renders the world, simulates the sensors and physics, follows routes the rover has already driven, and grades the result against ground truth the model never sees." Not SLAM (pose comes from the sim), not continuous motor control, not learning.

---

## 4. Prompt, packet, schema

### Permanent instruction

```
You are SARAH, an autonomous search-and-rescue rover in a dark forest at night. A hiker is
missing. Locate, confirm, and reach the person, then return to base along routes you have
driven. You have at most {budget} decisions.

Each turn you receive an RGB image and an aligned thermal image from the same camera (90°
horizontal FOV), a LiDAR grid over the same FOV, your pose, the topological map YOU have
built so far, and the result of your last action. Nobody else maps or plans: you decide when
a place is a node, which directions are frontiers, and where to go.

Conventions: meters; heading 0° = north, clockwise positive; turn_deg positive = right;
absolute bearing = heading + turn_deg. The LiDAR grid has 9 columns keyed by relative
bearing (-40..+40, 10° each) and 2 rows (level, ground); column k is image strip k, and
turn_deg equal to a column key points you at that column. The same columns are drawn on
the images with their distances.

Interpret RGB and thermal together. Thermal alone is a lead, never a confirmation: foxes,
deer and warm ground are hot too; glowing fungi are bright on camera but cold. A person is
ONE large, steady, human-shaped signature with matching RGB evidence that persists across
observations and does not move away when approached. Prefer safe unexplored frontiers
during search; investigate leads from safe viewpoints; approach a candidate only after
LIKELY; mark only after CONFIRMED_CANDIDATE on two consecutive observations within 2 m.
Do not drive into obstacles reported in the grid. Use GOTO_NODE to backtrack to a known
node instead of retracing with turns. Keep moves ≤ 15 m; use shorter moves when
investigating.

Return JSON only, matching the schema. brief_reason is one sentence; observations at most two.
```

### Per-decision observation packet

```json
{
  "mission": { "phase": "SEARCH", "step": 7, "decisions_remaining": 33, "distance_traveled_m": 48.2,
               "safe_return_path": ["N3", "N1", "BASE"], "previous_assessment": "NO_EVIDENCE" },
  "pose": { "x": 14.2, "z": -8.6, "heading_deg": 45, "at_node": "N3" },
  "lidar": {
    "level":  { "-40": {"m": 4.6, "hit": "TREE"}, "-30": {"m": 2.4, "hit": "TREE"}, "-20": {"m": 11.0, "hit": "TREE"},
                "-10": {"m": null, "hit": "CLEAR"}, "0": {"m": null, "hit": "CLEAR"}, "10": {"m": 9.1, "hit": "ROCK"},
                "20": {"m": 3.8, "hit": "TREE"}, "30": {"m": 3.1, "hit": "TREE"}, "40": {"m": 2.8, "hit": "TREE"} },
    "ground": { "-40": {"m": 3.0, "hit": "GROUND"}, "-30": {"m": 2.9, "hit": "GROUND"}, "-20": {"m": 3.1, "hit": "GROUND"},
                "-10": {"m": 6.5, "hit": "FALLEN_LOG"}, "0": {"m": 3.0, "hit": "GROUND"}, "10": {"m": 3.0, "hit": "GROUND"},
                "20": {"m": 2.2, "hit": "WATER"}, "30": {"m": 2.1, "hit": "WATER"}, "40": {"m": 3.0, "hit": "GROUND"} }
  },
  "map": {
    "nodes": [
      { "id": "BASE", "x": 0, "z": 0, "kind": "BASE", "visited": true, "bearing_from_rover_deg": 211, "distance_m": 16.6 },
      { "id": "N1", "x": 2.1, "z": -9.0, "kind": "JUNCTION", "visited": true, "note": "trail forks; log pile west", "bearing_from_rover_deg": 268, "distance_m": 12.1 },
      { "id": "N3", "x": 14.2, "z": -8.6, "kind": "VIEWPOINT", "visited": true, "last_assessment": "NO_EVIDENCE", "bearing_from_rover_deg": 0, "distance_m": 0 }
    ],
    "edges": [
      { "id": "E1", "from": "BASE", "to": "N1", "length_m": 9.3, "bearing_deg": 13, "safe": true, "terrain": "TRAIL", "hazard_cost": 0 },
      { "id": "E2", "from": "N1", "to": "N3", "length_m": 12.1, "bearing_deg": 88, "safe": true, "terrain": "FOREST", "hazard_cost": 0.2 }
    ],
    "frontiers": [
      { "id": "F1", "from_node": "N1", "bearing_deg": 300, "estimated_distance_m": 10, "geometry": "NARROW", "status": "UNEXPLORED", "note": "gap past the log pile" },
      { "id": "F2", "from_node": "N1", "bearing_deg": 88, "estimated_distance_m": 12, "geometry": "CLEAR", "status": "TRAVERSED" }
    ]
  },
  "last_result": "MOVED 12.1 m along heading 88°, now heading 45° after turn. Creek visible right."
}
```

Images (RGB, thermal, with overlay) precede the packet text in the `input` array. Expected size ≈ 1.5–2.5k input tokens per decision.

### Decision schema

```json
{
  "type": "object",
  "properties": {
    "observations": { "type": "string", "description": "Max 2 sentences: what RGB, thermal and the LiDAR grid jointly show, with bearings." },
    "map_update": {
      "type": "object",
      "properties": {
        "node_here": { "type": ["object", "null"], "properties": {
          "kind": { "type": "string", "enum": ["JUNCTION", "VIEWPOINT", "DEAD_END", "EVIDENCE", "SURVIVOR"] },
          "note": { "type": "string" } }, "required": ["kind", "note"] },
        "new_frontiers": { "type": "array", "items": { "type": "object", "properties": {
          "bearing_deg": { "type": "number" }, "estimated_distance_m": { "type": "number" },
          "geometry": { "type": "string", "enum": ["CLEAR", "NARROW", "UNCERTAIN"] }, "note": { "type": "string" } },
          "required": ["bearing_deg", "estimated_distance_m", "geometry", "note"] } },
        "frontier_updates": { "type": "array", "items": { "type": "object", "properties": {
          "id": { "type": "string" }, "status": { "type": "string", "enum": ["TRAVERSED", "BLOCKED"] } }, "required": ["id", "status"] } },
        "edge_annotation": { "type": ["object", "null"], "properties": {
          "terrain": { "type": "string", "enum": ["TRAIL", "FOREST", "SLOPE", "BRIDGE"] },
          "hazard_cost": { "type": "number" } }, "required": ["terrain", "hazard_cost"] }
      },
      "required": ["node_here", "new_frontiers", "frontier_updates", "edge_annotation"]
    },
    "survivor_assessment": { "type": "string", "enum": ["NO_EVIDENCE", "POSSIBLE", "LIKELY", "CONFIRMED_CANDIDATE"] },
    "evidence": { "type": "object", "properties": {
      "thermal": { "type": "number" }, "rgb_person": { "type": "number" }, "bearing_deg": { "type": ["number", "null"] } },
      "required": ["thermal", "rgb_person", "bearing_deg"] },
    "intent": { "type": "string", "enum": ["EXPLORE_FRONTIER", "FOLLOW_KNOWN_ROUTE", "INVESTIGATE_THERMAL_LEAD", "SCAN", "APPROACH_CANDIDATE", "MARK_SURVIVOR", "RETURN_TO_BASE"] },
    "action": { "type": "object", "properties": {
      "type": { "type": "string", "enum": ["MOVE", "GOTO_NODE", "MARK_SURVIVOR", "RETURN_TO_BASE"] },
      "turn_deg": { "type": "number", "description": "MOVE only, -180..180, positive = right." },
      "distance_m": { "type": "number", "description": "MOVE only, 0..15. 0 = turn in place to look." },
      "node_id": { "type": "string", "description": "GOTO_NODE only; must be a node id in the map." } },
      "required": ["type"] },
    "confidence": { "type": "number", "description": "0..1 that this action advances the mission." },
    "brief_reason": { "type": "string", "description": "One sentence, first person, for the operator." }
  },
  "required": ["observations", "map_update", "survivor_assessment", "evidence", "intent", "action", "confidence", "brief_reason"]
}
```

**Applied as:** `map_update` → store; `action` → executor (clamped to −180..180 / 0..15; unknown `node_id` → `last_result: "GOTO_NODE rejected: unknown node"`); `MARK_SURVIVOR` and `RETURN_TO_BASE` subject only to the two protocol rules in 3b; phase derived from `intent`; `observations`, `brief_reason`, `confidence`, thought summary → UI feed.

### `TerrainParams` schema (terrain chat)

`{ tree_density: 0..1, slope: 0..1, fallen_logs: 0..1, water: "none"|"creek"|"pond", fog_density: 0..1, moonlight: 0..1, fox_count: 0..2, deer_count: 0..2, fungi_patches: 0..3, branchiness: 0..1, seed?: number, narration: string }` — `narration` is one line shown in the chat.

---

## 5. 24-hour timeline, four parallel tracks

**P1 World & sensors** (forest, rover, headlamp, RGB/thermal passes, LiDAR grid, overlay, survivor, animals, fungi) · **P2 Brain** (`/api/decide`, schema, prompt, packet builder, terrain endpoint, replay format) · **P3 Loop, map store & executor** (types, store, edge recording, MOVE/GOTO_NODE/MARK/EXTRACT, Dijkstra, phase derivation, protocol rules, grading, manual console, replay player) · **P4 UI & demo** (layout, graph overlay, panels, feed, metrics, terrain chat UI, reveal-truth; then replay log, video, pitch; Tiger Data/Azure/domain after T+12).

| Window | P1 World & sensors | P2 Brain | P3 Loop, store, executor | P4 UI & demo |
| --- | --- | --- | --- | --- |
| **T+0 – 1** | All four: fix conventions (frame, heading sign, 90° FOV, 9×2 grid keys, node spacing, packet + schema as the P2↔P3 contract); scaffold Next.js; env vars; check limits in AI Studio and decide billing (§6). | | | |
| **T+1 – 4** | Seeded heightmap, moonlight, fog, trees/logs placeholders, base, rover with headlamp + camera; one camera rig for all sensors. | `/api/decide` with a canned packet + test images; structured output + zod; thinking summaries parsed; latency logged. Prompt v1. | Types, map store, edge recording, MOVE with collision stop on a flat plane, GOTO_NODE + Dijkstra, phase derivation, **manual decision console drives a full loop without Gemini**. | Layout shell: map/rover-panel swap, agent panel + feed on fake data, metrics strip. Mock `/api/decide` so nobody blocks on P2. |
| **T+4 – 8** | Thermal pass + offscreen targets; LiDAR grid (9×2) + image overlay; survivor, fox, deer, fungi with behaviors. | Prompt v2 on real packets + images from P1/P3; packet builder (`bearing_from_rover`, `safe_return_path`, `last_result`); backoff/retry; replay record format. | Wire real sensors; protocol rules for MARK/RETURN; grading vs ground truth; EXTRACT. | Graph overlay (nodes, edges, frontiers, return route); RGB/thermal panels live at 1 Hz; thermal toggle; waiting/error states. |
| **T+8 checkpoint** | **First Gemini-commanded MOVE executed on real terrain and a node/frontier it declared drawn on the map.** Otherwise P1 + P4 swarm the P2↔P3 seam. | | | |
| **T+8 – 12** | Trail branching/dead ends in the generator, collision geometry, water, slopes; perf (sensor renders only on the 1 Hz tick). | Prompt tuning on decoys and mapping quality across 5 seeds; `thinking_level` low vs medium; `TerrainParams` endpoint. | Mid-edge retrace, stuck/blocked handling, decision budget, replay player. | Terrain chat + advanced tab; rescue/extract visuals + sound; metrics wired; reveal-truth toggle. |
| **T+12 checkpoint** | **First complete mission (through RESCUE, correct mark) on a fixed seed.** Choose the demo seed. Stretch (Tiger Data, Azure, pointing/top-down map image) continues only if this passed. | | | |
| **T+12 – 16** | Polish: fungi glow, reflective jacket, headlamp cone, animal motion. | **Prompt freeze T+16.** Success-rate table over 5 seeds for the pitch. | Bug bash on 5 seeds. | Record demo-seed replay log; Tiger Data telemetry + chart; Azure deploy; domain. |
| **T+16 – 18** | Everyone: fix anything that strands the rover or stalls a phase. | | | |
| **T+18 — FEATURE FREEZE** | Fixes only. | | | |
| **T+18 – 20** | | | | **Record backup video** (3 min) live + replay takes; copy to two devices. |
| **T+20 – 22** | Fix what the recording exposed; README; Devpost text + screenshots. | | | |
| **T+22 – 23** | Pitch rehearsal ×3 with a timer, including one live run and one replay run. | | | |
| **T+23 – 24** | Submit early. Sleep. | | | |

Rules: small PRs to `main` behind flags; `Run` always starts a mission (live Gemini or replay); P4 owns the demo seed and replay log from T+12.

---

## 6. Risks and mitigations

| Risk | Why it is real | Mitigation |
| --- | --- | --- |
| **Quota** | 25–40 Gemini calls per mission; unofficial Sept 2026 free tier ≈ 5 RPM / **20 RPD** on Flash models, per project, resets midnight Pacific. One free-tier project cannot finish one mission. | Enable Tier 1 billing at T+0 (a mission ≈ 60–100k input tokens ≈ $0.05–0.10); ask organizers for credits; one Cloud project per teammate for dev; manual console + mock for all non-Gemini work. |
| **Latency per step** | 2–5 s thinking × 30 steps ≈ 2 min of waiting per mission. | `thinking_level: low`, `media_resolution: low`, compact packet; show the thought summary while waiting; 4 m/s travel; 3-minute demo budget. |
| **Gemini loops or gets lost** | Free-form control with no local planner. | This is the experiment: full map + `safe_return_path` + visited flags in every packet, decision budget, GOTO_NODE for backtracking, `last_result` closes the loop; tune prompt on 5 seeds; report the success rate honestly. |
| **Image ↔ world misreads** | Model has no camera intrinsics. | Shared camera for all sensors, grid keys = turn angles, overlay on the images, precomputed node bearings (§3c). Stretch: pointing coordinates. |
| **False positive on the deer** | Large, steady-ish, warm. | Intended difficulty; prompt teaches motion-on-approach and shape; two-observation rule; result card shows the outcome; tune deer flee radius so a careful agent can tell. |
| **Sensor renders tank frame rate** | Two extra render targets + readback + overlay. | Render sensors only on the 1 Hz tick at 512×384; low-poly; test on the demo laptop by T+8. |
| **API key in the browser** | Client keys are extractable. | Key only in the Route Handler env (`GEMINI_API_KEY`, never `NEXT_PUBLIC_*`); no browser→Gemini calls. |
| **Judge network** | Venue Wi-Fi. | Hotspot; replay needs no network; backup video on laptop and phone. |
| **Old tutorials / wrong API shape** | Blogs use `generateContent` and 2.5-era ids. | Only ai.google.dev + `@google/genai`; model id in one env var; smoke-test in hour 1. |
| **Scope creep** | Sponsor prizes + stretch bridges. | Nothing optional before the T+12 full-mission checkpoint; freeze at T+18. |

---

## 7. Open questions for the team

1. **Billing.** Card on a Google Cloud project for Tier 1? Organizer credits? With 25–40 calls per mission this is the biggest de-risking decision.
2. **Protocol rules.** Keep the two code-enforced rules (`MARK_SURVIVOR` needs CONFIRMED_CANDIDATE twice within 2 m; `RETURN_TO_BASE` only after RESCUE), or make them prompt-only so Gemini is checked by nothing but physics?
3. **Constants.** 90° FOV / 9×2 grid, 15 m max move, 40-decision budget, 2 m rescue range, 4 m/s, fox 6 m / deer 8 m flee radii: confirm at T+0.
4. **Overlay.** Burn the bearing/distance grid into the images Gemini receives (recommended, §3c), or send clean images and rely on the text grid only? Test both at T+8–12 if time allows.
5. **Three.js experience.** Who has shipped R3F? If nobody, P1 spends T+1–4 getting fogged terrain on screen and we simplify art.
6. **Thermal look.** White-hot grayscale or ironbow false color? Which does Gemini read better, and which projects better?
7. **Devices.** Presenting laptop and GPU; phone for hotspot; second machine for the backup video.
8. **Tiger Data / Azure.** Accounts or credits (GitHub Student Pack covers Azure)? P4 owns both after T+12; fine to drop if the checkpoint slips?
9. **Domain.** `wheresthehiker.com`, `lostinthewoods.help`, `sarahsearches.quest`, `nightrover.lol`.
10. **Submission logistics.** Devpost deadline, pitch length, live demo vs video.

---

### Reference links (checked 2026-10-03)

- Team spec: `multimodal_sar_agent_architecture.md` · Team brief: `internal/girlhacks-project-sarah.docx`
- Models and ids: [https://ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
- Image understanding (inline limits, tokens, `media_resolution`, normalized coordinates): [https://ai.google.dev/gemini-api/docs/image-understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- Structured output: [https://ai.google.dev/gemini-api/docs/structured-output](https://ai.google.dev/gemini-api/docs/structured-output)
- Thinking levels and thought summaries: [https://ai.google.dev/gemini-api/docs/thinking](https://ai.google.dev/gemini-api/docs/thinking)
- Rate limits (free-tier numbers only in AI Studio): [https://ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- Pricing: [https://ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
- API keys (restricted keys required): [https://ai.google.dev/gemini-api/docs/api-key](https://ai.google.dev/gemini-api/docs/api-key)
