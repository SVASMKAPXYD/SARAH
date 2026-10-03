# SARAH — 24-hour build plan (GirlHacks 2026, "Enchanted Grove")

**SARAH = Search And Rescue Autonomous Helper.** Sources of truth: the team brief (`internal/girlhacks-project-sarah.docx`) for the idea and prizes, the team's architecture spec (`internal/multimodal-sar-agent-architecture.md`) for the agent design, and the team's facts of 2026-10-03: 4 people, no physical camera, 1 snapshot per second from a procedurally generated grove, and an agent loop: terrain → snapshot (RGB + thermal + LiDAR) → Gemini → decision → rover moves in the sim → next snapshot.

**Core rule (from the spec):** Gemini is the high-level multimodal decision agent. Deterministic local code owns geometry, mapping, collision safety, path execution, and world truth. Gemini never sees the full map or the survivor's coordinates.

Gemini facts were checked against ai.google.dev on 2026-10-03. Google no longer publishes free-tier request limits; those numbers are flagged as unofficial.

---

## Decisions to confirm (spec vs. plan)

| # | Topic | Spec proposed | Plan proposed | Recommendation (one reason) |
| --- | --- | --- | --- | --- |
| D1 | **Decision unit** | Gemini picks one `choice_id` from local-code-supplied candidates (known edge, frontier, scan) at nodes/events; 10–25 decisions per mission | Gemini outputs free-form `turn_deg + distance_m` every ~5 s | **Adopt spec.** Every output is validated against a list, quota use drops 3–4×, and the local candidate scorer doubles as the Gemini-free fallback. Cost: topometric graph + Dijkstra code (P3's whole job). |
| D2 | **Mapping layer** | Sparse topometric graph (nodes, edges with polylines, frontiers), Dijkstra/A* for backtracking and extraction | Visited-cell grid + loop detection only | **Adopt spec, minimal version.** Frontiers = clear LiDAR sectors from the current node; edges = traversed polylines; Dijkstra over <50 nodes is ~30 lines. Use the plan's cell grid only as a debug overlay. |
| D3 | **Gemini output schema** | 5 fields: `choice_id, intent, survivor_assessment, confidence, brief_reason` | Rich `NavDecision` (heat-signature classification, landmarks, hazards, reasoning) | **Spec's 5 fields as the executed contract, plus one UI-only `observations` field** (≤2 sentences classifying what RGB/thermal show). Minimal = reliable; the extra field is what makes the thought feed and the Gemini-prize story land, and the executor ignores it. |
| D4 | **LiDAR encoding** | 7–9 rays over ±60°, named sectors (`far_left … far_right`) + terrain labels in the packet | 24 rays over 360° as a numeric array | **Both, different jobs.** Local code casts 24+ rays over 360° at nodes for frontier discovery; Gemini receives the spec's named forward sectors + terrain labels (more LLM-readable, fewer tokens). |
| D5 | **Thermal encoding** | Thermal image + `survivor_evidence {thermal, bearing, persistence_frames, rgb_person_evidence}`; node-level scores accumulated locally; multimodal confirmation gate | Thermal image + per-blob list (size, intensity, steadiness, count) | **Adopt spec's packet and gate.** Keep the plan's blob cues (size/steadiness/cluster count) *inside* the local `thermalScore` computation so fireflies score low and the fairy scores high; Gemini sees the summarized evidence plus the image. |
| D6 | **Mission scope** | SEARCH → INVESTIGATE → CONFIRM → RESCUE → EXTRACT (return to base) | Find the fairy and stop | **Adopt spec; EXTRACT is the cut line.** It needs zero extra Gemini calls (Dijkstra over safe edges) and is a strong demo beat, but RESCUE is the must-have payoff. Ship EXTRACT only if the graph is solid by T+12. |
| D7 | **Images per request** | RGB + aligned thermal (2 images), one request per decision | Last 3 RGB frames + thermal (4 images) | **Adopt spec (2 images).** With node-based decisions, motion sequences add tokens without adding information; the 1 Hz feed still drives the UI and `persistence_frames`. |
| D8 | **Decoys / terminology** | "Survivor", "base", "rover"; decoys = warm rock, campfire, animal, reflective object | Fairy in a jar; decoys = firefly jars | **Spec's names in code and packets, theme as the skin.** Survivor = trapped fairy; decoys = firefly jar (flickering cluster), warm mossy rock (steady heat, no RGB evidence), a fox (moving heat). Glowing mushroom = bright but cold. Multimodal gate is what rejects them. |
| D9 | **Track ownership** | Build order: world → graph/planner *without Gemini* → sensors → frontiers → Gemini → validation → UI → replay | P3 = loop + UI; Tiger Data/Azure on P4 from T+1 | **Adopt spec's build order.** P3 becomes Mapping & Planner (graph, frontiers, Dijkstra, state machine, heuristic autopilot); P4 owns UI + demo; Tiger Data/Azure move to post-T+12 stretch. |

Not in conflict (spec is silent, plan stands): rendered Three.js scene rather than AI-generated frames (§3a), `gemini-3.8-flash` via the Interactions API with structured output + thinking summaries, Next.js/R3F/shadcn stack, server-side key, replay mode, quota strategy (§6).

---

## 1. Pitch and prize mapping

**Pitch.** A fairy is trapped in a glass jar somewhere in a dark, fog-bound grove full of fallen logs, ponds, warm rocks and jars of fireflies. SARAH, a small rescue rover, starts at base with no map and only a description of the survivor. Every second it captures RGB, thermal and LiDAR; at every junction, dead end or new clue it hands Gemini the two images plus a compact summary of what it knows — safe routes, unexplored frontiers, thermal leads — and Gemini picks the next route, says how strong the survivor evidence is, and explains itself in one sentence. Local code never lets it walk through a tree, never accepts a hotspot alone as a person, and always knows the way back to base. Judges watch the rover explore, chase a thermal lead, dismiss fireflies and a warm rock, confirm the fairy with camera + thermal together, and return home along the route it mapped. The world itself is built from a sentence ("make it a foggy midnight grove with a frozen pond"), also interpreted by Gemini.

| Prize (from the brief) | How SARAH earns it |
| --- | --- |
| **Best use of Gemini API** (primary) | Gemini is the decision agent: joint RGB + thermal reasoning with live geometric constraints and a topological memory, structured-output route selection, survivor assessment with calibrated confidence, visible reasoning, plus a second language/creative use (natural-language terrain design, fairy's rescue message). Honest claim per the spec §14: not SLAM, not motor control. |
| **Enchanted Grove** (theme) | Dark enchanted grove, trapped fairy, firefly decoys, moonlight and fog, a Gemini constellation. Interactive story and sim, not a dashboard with forest wallpaper. |
| **Best use of Tiger Data** (stretch) | Every 1 Hz observation and every decision is a time-series event (pose, phase, evidence scores, confidence, latency, tokens). Hypertable + continuous aggregate feeding the metrics panel. |
| **Best use of Azure** (stretch) | Deploy the Next.js app to Azure App Service; demo runs locally; Azure is the public URL on Devpost. |
| **GoDaddy funny domain** (10 min) | Register a joke domain pointing at the Azure deployment (ideas in §7). |

Priority if time runs out: Gemini + theme, then Tiger Data, then Azure, domain whenever someone has 10 spare minutes.

---

## 2. MVP scope and demo storyboard

### In (must ship)
- **Procedural low-poly grove** (seeded): heightmap, fallen logs, ponds, bushes, fog, moonlight, blue night filter, rover headlamp, a **base** marker, several branches and dead ends.
- **Rover + sensors at 1 Hz**: RGB render, aligned thermal render (second material pass), LiDAR raycasts, pose. Snapshots feed the UI panels and the evidence accumulators.
- **Survivor**: fairy in a glass jar (large steady heat + visible jar). **Decoys**: firefly jar, warm rock, fox (see D8).
- **Topometric graph** (spec §4): nodes at base/junctions/dead ends/major turns/evidence; edges with polylines; frontiers from clear LiDAR sectors; Dijkstra over safe edges.
- **Mission state machine** (spec §7): SEARCH → INVESTIGATE → CONFIRM → RESCUE → (EXTRACT) → COMPLETE, with the multimodal confirmation gate.
- **Gemini decision at events only**: observation packet + 2 images → `choice_id` + assessment → validated → executor traverses the edge/frontier → graph update → next decision. Target 10–25 calls per mission.
- **Heuristic autopilot**: the local candidate scorer picks on its own when Gemini is unavailable (spec build step 2); also the mock for UI work.
- **UI** (brief + spec §11): third-person map view with graph overlay (big) + RGB/thermal rover panel (mini, swappable), thermal/light toggle, agent panel (phase, chosen candidate, assessment, confidence, one-line reason, text-message-style feed), metrics strip, Run / Pause / Regenerate / Reset, success sound.
- **Terrain chat**: natural language → Gemini → `TerrainParams` → regenerate; advanced tab; seed field.
- **Replay mode**: recorded decision log for the demo seed; zero network.

### Out
- Real camera/drone input, per-frame AI image generation (§3a), multiple rovers, dense occupancy grid, Live API voice, accounts, saving worlds, mobile polish, high-fidelity art, online learning of any kind.

### Demo-day storyboard (~2 minutes)
| Time | What judges see | The "whoa" |
| --- | --- | --- |
| 0:00 | Dark grove, fog, moon, rover at base. "Somewhere in these woods a fairy is trapped. SARAH has no map." | Theme lands. |
| 0:15 | Terrain chat: *"make it a foggy midnight grove with a frozen pond and more fallen logs."* World regenerates. | Gemini built the level from a sentence. |
| 0:35 | **Run**. Graph minimap sprouts nodes and frontiers. Agent panel: *SEARCH — chose F4 (northwest, clear) — "Highest information gain; no thermal lead yet."* | Visible, structured reasoning. |
| 0:55 | Thermal toggle. *INVESTIGATE — chose E9 toward weak signature — "Warm cluster ahead-right; approaching from the safe trail."* Rover arrives: *"Several small flickering points, no person-shaped RGB evidence — decoy."* Node marked, phase back to SEARCH. | It rejected the decoy with two modalities. |
| 1:25 | Second lead. *CONFIRM — "Large steady signature inside glass, persistent across 3 observations."* Gate passes, *RESCUE*, chime, fairy freed, Gemini-written thank-you line. | Payoff + story. |
| 1:45 | *EXTRACT* (if built): return route lights up on the graph; rover drives home with no further Gemini calls. Metrics: decisions made, leads investigated, decoys rejected, latency. Close on the domain. | It knows the way home. |

Rehearse on a fixed seed so the mission is ~12 decisions and finishes in under 90 s.

---

## 3. Architecture and stack

### 3a. Rendered scene vs. AI-generated camera images: render it

| | Three.js render (recommended) | Gemini image generation per frame (Nano Banana 2 / 2 Lite) |
| --- | --- | --- |
| Frame-to-frame consistency | Exact; the rover really is in that world | None; routes and bearings have no visual meaning |
| LiDAR / thermal / collisions | Free from the same scene graph | Must be faked separately; won't match the picture |
| Latency per frame | ~5 ms | Seconds; impossible at 1 FPS |
| Cost / limits | $0 | **Paid-only** (`gemini-3.1-flash-image`, `-lite-image` ≈ $0.03–0.05/image); one mission ≈ 60+ images |

Verdict: render. Image generation only for one-off assets (title card, fairy portrait via AI Studio) or a stretch post-mission illustration from the mission log.

### 3b. Components (spec §3 terminology)

```
Browser (Next.js + React Three Fiber)
  Three.js world ── seeded terrain, obstacles, base, survivor, decoys; ground truth; raycast truth
  Sensors @ 1 Hz ── RGB JPEG + aligned THERMAL JPEG (offscreen render targets), LiDAR fan, pose
  Local perception/mapping ── traversability from rays, node/edge/frontier updates, evidence
                              accumulation (thermalScore, rgbPersonScore, evidenceFrames),
                              candidate generation + scoring, Dijkstra routes, observation packet
  Mission state machine ── SEARCH → INVESTIGATE → CONFIRM → RESCUE → EXTRACT → COMPLETE
  Decision scheduler ── at arrival node / interrupt: POST /api/decide { packet, rgb, thermal }
          │
          ▼
  Next.js Route Handler (server; GEMINI_API_KEY)
    @google/genai interactions.create({ model: gemini-3.8-flash,
      input: [rgb image, thermal image, packet JSON as text],
      response_format: DecisionSchema,
      generation_config: { thinking_level: "low", thinking_summaries: "auto", media_resolution: "low" } })
    zod-validate → { decision, thoughtSummary, latencyMs, tokens }   (stretch: INSERT → Tiger Data)
          │
          ▼
  Local executor ── validate choice_id ∈ candidates, intent ∈ phase; follow edge polyline or
                    traverse frontier corridor until junction / dead end / evidence / hazard;
                    collision raycasts every frame; on event → map update → next decision
  UI ── third-person + graph overlay, RGB/thermal panels, agent panel/feed, metrics
```

### 3c. Sim and rover-state component (explicit)

- **World truth** lives only in the Three.js scene. `RoverState { x, z, headingDeg, speed, phase, currentNode, step }`. Units meters; node spacing 3–5 m; rescue range 2 m.
- **Snapshot scheduler (1 Hz, always on while running):** render RGB + thermal into 512×384 targets, read back as JPEG q0.7, cast the 360° LiDAR fan (24 rays, 30 m max), update local evidence (below), push to a 5 s ring buffer. This is the "1 FPS feed"; it drives the panels and `persistence_frames`.
- **Node creation** (spec §4.2): base; ≥2 safe outgoing routes; dead end; heading change >30°; evidence crosses threshold; >3–5 m from nearest node; task-important. Not every meter.
- **Frontier discovery:** cluster clear 360° sectors into frontiers `{ bearingDeg, estimatedDistanceM, geometry: CLEAR|NARROW|UNCERTAIN, thermalAlignment, expectedInformationGain, status }`; information gain = fraction of unknown cells (coarse 4 m grid, debug-only) in that direction.
- **Candidate generation + local score** (spec §7): top 3–5 of known edges + frontiers + `SCAN_HERE`, scored \(S = w_I I + w_T T - w_C C - w_H H\). The top-scored candidate is the **heuristic autopilot** choice when Gemini is down.
- **Executor:** known edge → follow polyline at 4 m/s; frontier → move along bearing until a node-creation event, raycast every frame, stop 0.5 m short of hits (edge marked `safe=false` if blocked). Interrupt and re-query only on: strong new evidence, blocked path, new branch, execution failure, hazard.
- **Evidence (local, deterministic, simulated sensors):** `thermalScore` from hotspots in the thermal frustum weighted by apparent size, steadiness and cluster count (fairy high, fireflies/fox low, warm rock medium); `rgbPersonScore` from a simulated detector (survivor in RGB frustum, unoccluded by raycast, distance-weighted; warm rock scores 0); `evidenceFrames` counts consecutive 1 Hz observations above threshold. **Confirmation gate:** Gemini `CONFIRMED_CANDIDATE` **and** thermal ≥ 0.65 **and** RGB ≥ 0.50 **and** persistence ≥ 2 observations.
- **Routing:** Dijkstra over `safe` edges, cost \(d_e + \lambda_h h_e + \lambda_r r_e\); used for backtracking to a frontier's origin node and for EXTRACT.
- **Replay recorder:** each decision appends `{ seed, step, packetHash, decision, thought, latencyMs }`; `?replay=<file>` drives the executor from the log.

### 3d. Sensor encoding for Gemini (per D4/D5/D7)

| Input | Encoding | Notes |
| --- | --- | --- |
| **RGB** | 1 JPEG 512×384, `media_resolution: low` | ~66–258 tokens. |
| **Thermal** | 1 aligned false-color JPEG (heat on black) | Same camera pose, second material pass. |
| **LiDAR** | `lidar_m` named sectors `far_left, left, front_left, front, front_right, right, far_right` (±60°) + `terrain` labels (`TRAVERSABLE | FALLEN_LOG | WATER | SLOPE | NARROW`) | Local code uses the full 360° fan; Gemini gets the readable summary. |
| **Evidence** | `survivor_evidence { thermal: NONE|WEAK|MODERATE|STRONG, bearing_deg, persistence_frames, rgb_person_evidence: NONE|UNCERTAIN|LIKELY }` | Summarized from local scores; never raw coordinates. |
| **Memory** | `topological_memory { coverage_pct, known_nodes, safe_return_path, recently_searched }` | Compact; exact geometry stays local. |
| **Candidates** | 3–5 entries with `id, type, direction, distance_m, safety, thermal_alignment, information_gain` + `SCAN_HERE` | The only things Gemini may choose. |

### 3e. Stack
- **Next.js (App Router) + React + TypeScript**; **Three.js + @react-three/fiber + @react-three/drei** (`useFBO` render targets, `Html`, `Stars`); **@google/genai** server-side via the **Interactions API**; **zod**; **Tailwind + shadcn/ui**. Optional: `pg` + Tiger Data, Azure App Service.
- **Model:** `gemini-3.8-flash` (stable; structured outputs; thinking low/medium/high; no Live API). Fallback `gemini-3.5-flash-lite` (free tier reportedly 15 RPM / 500 RPD vs ~5 RPM / 20 RPD for Flash models; unofficial Sept 2026). Model id in an env var; test both in hour 1.
- **Gemini features used:** multimodal image input (inline), structured output (`response_format` JSON schema) for decisions and `TerrainParams`, `thinking_level: "low"` + `thinking_summaries: "auto"` for the feed (summaries may be empty, so `brief_reason` is the guaranteed text), one creative call for the fairy's line. Stretch: function calling (`scan`, `approach`) and Gemini Robotics ER 2 "point to survivor" overlay. Not used: Live API (audio-first, no structured output, 2-min video sessions, ephemeral tokens), `previous_interaction_id` (spec: never rely on context for geometry).
- **Fallbacks on stage:** heuristic autopilot (no Gemini, same UI with an "autopilot" badge) → replay log → backup video. Automatic on 429/5xx after one retry and a model fallback.

---

## 4. Prompt and schema design

### Decision schema (spec §9 + one UI-only field)
```json
{
  "type": "object",
  "properties": {
    "choice_id": { "type": "string", "description": "Must be one of the candidate ids in the input." },
    "intent": { "type": "string", "enum": ["EXPLORE_FRONTIER", "FOLLOW_KNOWN_ROUTE", "INVESTIGATE_THERMAL_LEAD", "SCAN", "APPROACH_CANDIDATE", "MARK_SURVIVOR", "RETURN_TO_BASE"] },
    "survivor_assessment": { "type": "string", "enum": ["NO_EVIDENCE", "POSSIBLE", "LIKELY", "CONFIRMED_CANDIDATE"] },
    "confidence": { "type": "number", "description": "0..1 that this choice advances the mission." },
    "brief_reason": { "type": "string", "description": "One sentence, first person, for the operator." },
    "observations": { "type": "string", "description": "UI only. Max 2 sentences: what RGB and thermal jointly show (e.g. 'several small flickering points, no person-shaped object' or 'one large steady signature inside a glass jar')." }
  },
  "required": ["choice_id", "intent", "survivor_assessment", "confidence", "brief_reason", "observations"]
}
```

**Validation (spec §9):** `choice_id` ∈ supplied candidates; `intent` compatible with phase; `MARK_SURVIVOR` only if the local gate passes; `RETURN_TO_BASE` only after RESCUE; invalid or timed-out output → `SCAN_HERE` once, then heuristic autopilot. `brief_reason`/`observations` are UI-only.

### Permanent instruction (spec §8, themed)
```
You are SARAH, the high-level decision agent for a simulated search-and-rescue rover in a
dark enchanted grove. Mission priority: locate, confirm, rescue, and extract a missing
survivor (described only as "a trapped fairy", a fairy inside a glass jar) while preserving
a safe route to base.

You receive an aligned RGB image and thermal image, local geometry, survivor evidence, and
a compact topological map summary. Geometry and the candidate list are authoritative. You
cannot see the full terrain.

Treat thermal evidence alone as a lead, not confirmation: fireflies, warm rocks and animals
are warm too. A survivor shows ONE large, steady signature AND person-shaped or jar-shaped
RGB evidence that persists across observations. Prefer safe unexplored routes during
SEARCH; investigate leads from safe viewpoints; never choose an unlisted route.

Choose exactly one candidate from the input. Return JSON only, matching the schema.
brief_reason is one sentence; observations is at most two.
```

### Per-decision observation packet (spec §8, abridged)
```json
{
  "mission_phase": "SEARCH",
  "pose": { "node": "N12", "x": 14.2, "z": -8.6, "heading_deg": 45 },
  "lidar_m": { "far_left": 4.6, "left": 2.4, "front_left": 1.7, "front": 3.8, "front_right": 4.2, "right": 3.1, "far_right": 2.8 },
  "terrain": { "front": "TRAVERSABLE", "left": "FALLEN_LOG", "front_right": "TRAVERSABLE" },
  "topological_memory": { "coverage_pct": 34, "known_nodes": 17, "safe_return_path": ["N12", "N9", "N4", "BASE"], "recently_searched": ["N10", "N11"] },
  "survivor_evidence": { "thermal": "WEAK", "bearing_deg": 18, "persistence_frames": 1, "rgb_person_evidence": "UNCERTAIN" },
  "candidates": [
    { "id": "E17", "type": "KNOWN_EDGE", "destination": "N13", "direction": "EAST", "distance_m": 17, "safety": "KNOWN_SAFE", "thermal_alignment": 0.62, "information_gain": 0.30 },
    { "id": "F4", "type": "FRONTIER", "direction": "NORTHWEST", "estimated_distance_m": 9, "safety": "CLEAR", "thermal_alignment": 0.08, "information_gain": 0.85 },
    { "id": "SCAN_HERE", "type": "SCAN", "safety": "CLEAR" }
  ],
  "last_result": "Reached N12 safely; weak thermal signature became visible ahead-right."
}
```
Images (RGB, thermal) precede the packet text in the `input` array. Expected size ≈ 1–1.5k input tokens per decision.

### `TerrainParams` schema (terrain chat)
`{ biome: "grove"|"frozen"|"swamp"|"ruins", bumpiness: 0..1, tree_density: 0..1, obstacle_scale: 0..1, pond_count: 0..4, fog_density: 0..1, light: "sun"|"evening"|"moon", decoy_count: 0..3, branchiness: 0..1, seed?: number, narration: string }` — `narration` is a one-line flavor text shown in the chat.

---

## 5. 24-hour timeline, four parallel tracks (spec build order)

**P1 World & sensors** (Three.js world, RGB/thermal passes, LiDAR fan, survivor/decoys, evidence sensors) · **P2 Brain** (Gemini route, schema, prompt, validation, fallbacks, terrain chat endpoint) · **P3 Mapping & planner** (topometric graph, frontiers, candidate scoring, Dijkstra, mission state machine, executor, heuristic autopilot, replay) · **P4 UI & demo** (layout, graph overlay, panels, agent feed, metrics, terrain-chat UI; then replay log, video, pitch; Tiger Data/Azure/domain after T+12).

| Window | P1 World & sensors | P2 Brain | P3 Mapping & planner | P4 UI & demo |
| --- | --- | --- | --- | --- |
| **T+0 – 1** | All four: confirm the Decisions table; fix conventions (meters, bearing sign, node spacing, sector names, packet + schema shapes as the P2↔P3 contract); scaffold Next.js; env vars; check free-tier limits in AI Studio and decide billing (§6). | | | |
| **T+1 – 4** | Seeded heightmap, moonlight, fog, night filter, placeholder obstacles, base marker, rover with headlamp + camera. | `/api/decide` with a canned packet + test images; structured output + zod; thinking summaries parsed; latency logged. Prompt v1. | Graph types, node-creation rules, frontier discovery from a fake 360° fan, Dijkstra, state machine skeleton, executor on a flat plane. **Heuristic autopilot runs a full search/rescue with no Gemini** (spec step 2). | Layout shell: map/rover-panel swap, top bar, agent panel + feed with fake data, metrics strip. Mock `/api/decide` so nobody blocks on P2. |
| **T+4 – 8** | Thermal material pass + offscreen targets; real LiDAR fan; survivor + firefly jar + warm rock + fox; thermal/RGB evidence sensors. | Prompt v2 on real packets + images from P1/P3; validation rules; model fallback + backoff; replay record format. | Wire real sensors into mapping; candidate generation + scoring; confirmation gate; interrupts. | Graph overlay on the map (nodes, safe edges, frontiers, return route); RGB/thermal panels live at 1 Hz; thermal toggle; loading/error/autopilot badges. |
| **T+8 checkpoint** | **First Gemini-chosen candidate executed on real terrain.** Otherwise P1 + P4 swarm the P2↔P3 seam. | | | |
| **T+8 – 12** | Obstacle variety, branches/dead ends in the generator, collision geometry, perf (sensor renders only on the 1 Hz tick). | Assessment/confidence tuning on decoys; `TerrainParams` endpoint; fairy thank-you call. | EXTRACT via Dijkstra; backtracking through known edges; stuck handling; replay player. | Terrain chat window + advanced tab; success/extract visuals + sound; metrics wired. |
| **T+12 checkpoint** | **First complete mission (through RESCUE) on a fixed seed.** Choose the demo seed. Stretch (EXTRACT polish, Tiger Data, Azure, Robotics ER, function calling) continues only if this passed. | | | |
| **T+12 – 16** | Polish: stars, Gemini constellation, glass-jar material, firefly flicker, headlamp cone. | **Prompt freeze T+16.** Stretch: Robotics ER "point to survivor" overlay. | Bug bash on 5 seeds; tune node density and scores. | Record demo-seed replay log; typewriter feed; `speechSynthesis` toggle; Tiger Data telemetry + chart; Azure deploy; domain. |
| **T+16 – 18** | Everyone: fix anything that strands the rover or stalls a phase. | | | |
| **T+18 — FEATURE FREEZE** | Fixes only. | | | |
| **T+18 – 20** | | | | **Record backup video** (2 min) live + replay takes; copy to two devices. |
| **T+20 – 22** | Fix what the recording exposed; README; Devpost text + screenshots. | | | |
| **T+22 – 23** | Pitch rehearsal ×3 with a timer, including one autopilot run and one replay run. | | | |
| **T+23 – 24** | Submit early. Sleep. | | | |

Rules: small PRs to `main` behind flags; `Run` always works (autopilot if nothing else); P4 owns the demo seed and replay log from T+12.

---

## 6. Risks and mitigations

| Risk | Why it is real | Mitigation |
| --- | --- | --- |
| **Graph/planner code eats the day** | D1/D2 add a mapping layer the plan didn't have. | Minimal version only (frontiers from clear sectors, polylines, Dijkstra); autopilot proves it end-to-end by T+4 without Gemini; dense grid is debug-only. If P3 slips past T+8, degrade to "frontiers only, no known-edge reuse." |
| **1 FPS ≠ 1 Gemini call per second** | 60 RPM is far above free-tier RPM (~5–15) and latency (2–5 s). | Spec cadence: decisions only at nodes/events (10–25 per mission). 1 Hz is sensing and evidence persistence. Say so in the pitch. |
| **Free-tier RPD** | Unofficial Sept 2026: ~5 RPM / **20 RPD** on 3.8/3.7/3.6/3.5 Flash; 15 RPM / 500 RPD on 3.5 Flash-Lite; per project, resets midnight Pacific. One mission ≈ 10–25 calls. | Check AI Studio at T+0; enable Tier 1 billing (a mission ≈ 30k input tokens ≈ $0.03); ask organizers for credits; one Cloud project per teammate; autopilot + mock for all non-Gemini work. |
| **RPM throttling / latency** | Bursty testing; thinking + 2 images ≈ 2–5 s. | Single in-flight call, backoff, model fallback; `thinking_level: "low"`, `media_resolution: "low"`; waiting is covered by traversal animation. |
| **Gemini picks badly or hallucinates** | Wrong candidate, false `CONFIRMED_CANDIDATE`. | Only listed candidates are executable; gate requires thermal + RGB + persistence; `MARK_SURVIVOR` needs the local gate; rationale is UI-only (spec §9). |
| **Decoys too easy or too hard** | Both ruin the moment. | Evidence sensors designed so fireflies/fox fail thermal, warm rock fails RGB; tune thresholds on 5 seeds by T+16. |
| **API key in the browser** | Client keys are extractable; Google rejects unrestricted keys. | Key only in the Route Handler env (`GEMINI_API_KEY`, never `NEXT_PUBLIC_*`); no browser→Gemini calls. |
| **Judge network** | Venue Wi-Fi. | Hotspot; autopilot and replay need no network; backup video on laptop and phone; demo runs locally. |
| **SAR safety framing** | "Would you trust this in a real rescue?" | Use spec §14 verbatim: Gemini chooses among safe routes with multimodal evidence; deterministic code owns the map, validation, backtracking and extraction. A simulation and decision-support prototype, not a deployable system. |
| **Sensor renders tank frame rate** | Two extra render targets + readback. | Render sensors only on the 1 Hz tick at 512×384; low-poly; test on the demo laptop by T+8. |
| **Old tutorials / wrong API shape** | Blogs use `generateContent` and 2.5-era ids (access-restricted for new projects). | Only ai.google.dev + `@google/genai`; model id in one env var; smoke-test in hour 1. |
| **Scope creep** | Sponsor prizes + EXTRACT + stretch Gemini features. | Nothing optional before the T+12 full-mission checkpoint; freeze at T+18. |

---

## 7. Open questions for the team

1. **Confirm the Decisions table** (D1–D9), especially D1/D2 (graph-based candidates) and D6 (is EXTRACT in the MVP or the cut line?).
2. **Billing.** Card on a Google Cloud project for Tier 1 (cents per mission)? Organizer credits? Biggest single de-risking decision.
3. **RGB person evidence.** OK that `rgbPersonScore` is a *simulated detector* (survivor in frustum, unoccluded, distance-weighted) while Gemini's `survivor_assessment` is the model-side judgment? Alternative: let Gemini's assessment alone drive the RGB term (more "AI", less deterministic).
4. **Three.js experience.** Who has shipped R3F? If nobody, P1 spends T+1–4 getting fogged terrain on screen and we simplify art.
5. **Decoy set.** Firefly jar + warm rock + fox + cold glowing mushroom, or fewer? Each needs sensor behavior and placement rules.
6. **Constants.** Node spacing 3–5 m, 24-ray 360° fan locally / 7 named sectors to Gemini, rescue range 2 m, gate thresholds 0.65 / 0.50 / 2 frames, 25-decision cap: confirm or change at T+0.
7. **Thermal look.** Full false-color, or dark render with glowing heat only (cheaper, projects better)?
8. **Devices.** Presenting laptop and GPU; phone for hotspot; second machine for the backup video.
9. **Tiger Data / Azure.** Accounts or credits (GitHub Student Pack covers Azure)? P4 owns both after T+12; fine to drop if the checkpoint slips?
10. **Domain.** `fairyfinder.lol`, `lostwoods.help`, `wheresmyfairy.com`, `sarahsavesfairies.com`, `thermalfairy.quest`.
11. **Submission logistics.** Devpost deadline, pitch length, live demo vs video.

---

### Reference links (checked 2026-10-03)
- Team spec: `internal/multimodal-sar-agent-architecture.md` · Team brief: `internal/girlhacks-project-sarah.docx`
- Models and ids: https://ai.google.dev/gemini-api/docs/models
- Image understanding (inline limits, tokens, `media_resolution`): https://ai.google.dev/gemini-api/docs/image-understanding
- Video understanding (1 FPS static mode, Files API vs inline): https://ai.google.dev/gemini-api/docs/video-understanding
- Structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Thinking levels and thought summaries: https://ai.google.dev/gemini-api/docs/thinking
- Function calling (Interactions API): https://ai.google.dev/gemini-api/docs/function-calling
- Live API overview and limits: https://ai.google.dev/gemini-api/docs/live-api
- Rate limits (free-tier numbers only in AI Studio): https://ai.google.dev/gemini-api/docs/rate-limits
- Pricing (image generation is paid-only): https://ai.google.dev/gemini-api/docs/pricing
- API keys (restricted keys required): https://ai.google.dev/gemini-api/docs/api-key
- Gemini Robotics ER 2 (stretch): https://ai.google.dev/gemini-api/docs/robotics-overview
