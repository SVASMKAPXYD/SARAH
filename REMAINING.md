# Remaining

`azael` @ `999959a`. The loop through T+4–8 is in the tree and runs on the mock decider. A live Gemini call, a complete mission, and any host are not. Do the live checkpoint next. The T+12 demo replay stays deferred.

## Next — live Gemini (T+8)

1. **Billing.** Plan §7.1 is still open. §6: one free-tier project cannot finish a mission (25–40 calls). Turn on Tier 1, or organizer credits, before a live run.
2. **Smoke-test the client.** `GEMINI_API_KEY` is empty. `DECIDER=mock` forces the mock decider even after a key is set (`src/app/api/decide/route.ts`, same for `/api/terrain`). `src/lib/gemini/client.ts` has never called the Interactions API with a live key; field names are only checked against `@google/genai` 2.27 typings (`TODO(P2)`).
3. **T+8 checkpoint.** One live `MOVE` on the sim terrain, and a node or frontier that call declared, drawn on the map.

## Before a real deploy

Plan §5 schedules Azure App Service at T+12–16, and only after the checkpoint in the next section. The host files are missing either way.

- No Dockerfile, `vercel.json`, Azure / App Service config, or CI.
- A public build must not force mock: leave `DECIDER` unset once the key works. Keep `GEMINI_API_KEY` server-only.
- `NEXT_PUBLIC_DEV_CONSOLE=1` is in `.env.example` and would ship the manual console. The demo build hides it (plan §2). `?dev=1` still opens it.
- Tiger Data is not started. Plan §1 and §7.8: stretch, and fine to drop if the checkpoint slips. Not required for a public URL.
- No automated tests. The plan does not schedule any.

## Deferred — T+12 demo replay

Not the next action. `public/replays/demo.json` is one example `MOVE` on seed 1337 (narration in the file says to replace it). Record only when a run is worth keeping: Controls → Save replay, then `/?replay=demo` (zero network).

Must be true first:

- A full mission on a fixed seed reaches **RESCUE with a correct mark** (plan §5). The mock decider never marks a survivor; a mock run ends when the 40-decision budget runs out. SEARCH → RESCUE → EXTRACT has not been played through, including from the manual console.
- The prompt has been tried on decoys and mapping across 5 seeds. `thinking_level` is hardcoded `"low"` in `client.ts`; the `"medium"` trial (plan §3f, T+8–12) has not been run. Success-rate notes for the pitch are T+12–16, after that first correct mission.

Already in the tree, so they are not reasons to wait: branching trails, creek and pond, the decision budget, mid-edge retrace, `BLOCKED` moves, terrain chat and the advanced tab, the metrics strip, reveal-truth, and the replay player.

## Stubs (not deploy blockers)

- LiDAR and collision are a 2D ray-vs-circle over the obstacle list (`sensors.ts` `TODO(P1)`), not mesh raycasts. The world **edge** is labelled `STEEP_SLOPE` and stops the rover. Heightmap slopes steeper than 35° do neither (`terrain.ts` `TODO(P1)`).
- Sensor passes still render at 1 Hz while idle (`SensorRig.tsx` `TODO(P1)`). Plan T+8–12: only on the tick.
- Animals ignore obstacles and water; legs are not animated (`animals.ts` `TODO(P1)`).
- No rescue or extract sound (plan T+8–12). Fungi glow, jacket reflective strips, and a headlamp cone are already in the scene.
