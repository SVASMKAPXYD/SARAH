# Remaining

`azael` @ `74853d3`. The loop through T+4–8 is in the tree and runs on the mock decider. Terrain chat regenerates the forest (including bumpiness, light, cars, and survivor situation), and the stage UI (map, POV, thought, place graph) is in. No live Gemini decision, complete mission, or public deployment has been verified. The T+8 live checkpoint remains next; the T+12 demo replay stays deferred.

## Next — live Gemini (T+8)

1. **Turn live mode on.** `.env.local` has a `GEMINI_API_KEY`, but `DECIDER=mock`, so **Run** still uses the mock decider. Clear `DECIDER` (leave it unset) before a live call. `/api/terrain` ignores `DECIDER` and will call Gemini whenever the key is set, so a terrain-chat sentence can spend quota even while Run is mocked.
2. **Billing.** No project billing or organizer credits are confirmed. Current AI Studio billing/rate-limit setup is documented in [`deployment.md`](./deployment.md); check this project's current model quotas and billing plan before a full mission (up to 40 calls).
3. **Smoke-test the client.** The image, `resolution`, structured-output, and Interactions request fields match the docs checked on 2026-10-03, but no live request has been made (`TODO(P2)` in `src/lib/gemini/client.ts`). `/api/health` reports configuration only.
4. **T+8 checkpoint.** One live `MOVE` on sim terrain, with a node or frontier declared by that response and drawn on the map. The source badge must say `LIVE · gemini`.

## Before a real deploy

Plan §5 schedules Azure App Service at T+12–16, after the live checkpoint. [`.vscode/settings.json`](./.vscode/settings.json) points the App Service extension at `girlhacksbackend` (`girlhacks2026`). That target is not a verified deployment: no public URL has been checked, and there is no Dockerfile or CI. Node.js 24 LTS is recommended; Next.js 16 requires Node.js 20.9 or newer.

- A public build must not force mock: leave `DECIDER` unset in App Service. Keep `GEMINI_API_KEY` server-only. Do not deploy the local `DECIDER=mock` setting.
- The manual console is development-only. This machine sets `NEXT_PUBLIC_DEV_CONSOLE=1`; production ignores `?dev=1` and hides the manual controls. Do not set that variable on App Service.
- Tiger Data is not integrated. Plan §1 and §7.8: stretch, and fine to drop if the checkpoint slips. A local credentials file is gitignored; nothing reads it.
- No automated tests. The plan does not schedule any.

## Deferred — T+12 demo replay

Not the next action. `public/replays/demo.json` is one example `MOVE` on seed 1337 (narration in the file says to replace it). Record only when a run is worth keeping: Controls → Save replay, then `/?replay=demo` (zero network).

Must be true first:

- A full mission on a fixed seed reaches **RESCUE with a correct mark** (plan §5). The mock decider never marks a survivor; a mock run ends when the 40-decision budget runs out. SEARCH → RESCUE → EXTRACT has not been played through, including from the manual console.
- The prompt has been tried on decoys and mapping across 5 seeds. `thinking_level` is hardcoded `"low"` in `client.ts`; the `"medium"` trial (plan §3f, T+8–12) has not been run. Success-rate notes for the pitch are T+12–16, after that first correct mission.
- Rescue and extract sounds (plan T+8–12) are still absent.

Already in the tree, so they are not reasons to wait: branching trails, creek and pond, bumpiness, the decision budget, mid-edge retrace, `BLOCKED` moves, terrain chat and the advanced tab, the stage layout, the metrics strip, reveal-truth, and the replay player. Fungi glow, jacket reflective strips, and a headlamp cone are already in the scene.

## Stubs (not deploy blockers)

- LiDAR and collision are a 2D ray-vs-circle over the obstacle list (`sensors.ts` `TODO(P1)`), not mesh raycasts. The world **edge** is labelled `STEEP_SLOPE` and stops the rover. Heightmap slopes steeper than 35° do neither (`terrain.ts` `TODO(P1)`).
- Sensor passes still render at 1 Hz while idle (`SensorRig.tsx` `TODO(P1)`). Plan T+8–12: only on the tick.
- Animals ignore obstacles and water; legs are not animated (`animals.ts` `TODO(P1)`).
