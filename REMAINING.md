# Remaining

`azael` @ `999959a`. The loop through T+4–8 is in the tree and runs on the mock decider. The production build now passes on Node 24, and lint/typecheck pass. No live Gemini call, complete mission, or deployment has been verified. Checked against current provider docs on 2026-10-03. The T+8 live checkpoint remains next; the T+12 demo replay stays deferred.

## Next — live Gemini (T+8)

1. **Billing.** No project billing or organizer credits are confirmed. Current AI Studio billing/rate-limit setup is documented in [`deployment.md`](./deployment.md); check this project's current model quotas and billing plan rather than relying on old free-tier estimates.
2. **Smoke-test the client.** No `.env.local` or `GEMINI_API_KEY` is present here, so no live request was possible. `DECIDER` is now blank in `.env.example`, so a key enables live calls by default. The image, `resolution`, structured-output, and Interactions request fields match current Google docs, but the actual request still needs a live smoke test (`TODO(P2)` in `src/lib/gemini/client.ts`).
3. **T+8 checkpoint.** Still outstanding: one live `MOVE` on sim terrain, with a node or frontier declared by that response and drawn on the map. The local `/api/health` endpoint reports configuration only; verify the `LIVE · gemini` response in the UI.

## Before a real deploy

Plan §5 schedules Azure App Service at T+12–16, after the live checkpoint. [`deployment.md`](./deployment.md) now documents an early Azure prototype path, but no cloud resource or deployment exists yet.

- No Dockerfile, `vercel.json`, Azure / App Service config, or CI. Node.js 24 LTS is recommended; Next.js 16 requires Node.js 20.9 or newer. `npm run build` passes on Node 24.
- A public build must not force mock: leave `DECIDER` unset. Keep `GEMINI_API_KEY` server-only. The sample no longer forces mock.
- The manual console is now development-only: the sample no longer enables it by default, and production ignores `?dev=1` and hides the manual controls.
- Tiger Data is not started or integrated. Plan §1 and §7.8: stretch, and fine to drop if the checkpoint slips. Not required for a public URL.
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
