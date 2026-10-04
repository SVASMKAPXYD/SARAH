/**
 * POST /api/decide  { packet, rgb: base64 jpeg, thermal: base64 jpeg, depth: base64 png }
 *   → { decision, thoughtSummary, latencyMs, tokens, source: 'gemini' | 'mock' }
 *
 * Mock when: GEMINI_API_KEY missing, `?mock=1`, or DECIDER=mock. Otherwise Gemini.
 * Zod-validates the decision shape (shape only — no local judgment of the content).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DECISION_BUDGET } from '@/lib/constants';
import { geminiDecide, hasGeminiKey } from '@/lib/gemini/client';
import { mockDecide } from '@/lib/gemini/mock';
import { DecisionSchema } from '@/lib/gemini/schema';
import { SENSOR_CALIBRATION } from '@/lib/sim/depth';
import type { DecideResponse, ObservationPacket } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isObservationPacket(value: unknown): value is ObservationPacket {
  if (typeof value !== 'object' || value === null) return false;
  const packet = value as Record<string, unknown>;
  if ('lidar' in packet || typeof packet.pose !== 'object' || packet.pose === null
    || typeof packet.map !== 'object' || packet.map === null
    || typeof packet.mission !== 'object' || packet.mission === null
    || typeof packet.last_result !== 'string'
    || typeof packet.sensors !== 'object' || packet.sensors === null) return false;
  const sensors = packet.sensors as Record<string, unknown>;
  if (!Array.isArray(sensors.image_order)
    || typeof sensors.depth !== 'object' || sensors.depth === null) return false;
  const depth = sensors.depth as Record<string, unknown>;
  return sensors.image_width === SENSOR_CALIBRATION.image_width
    && sensors.image_height === SENSOR_CALIBRATION.image_height
    && sensors.horizontal_fov_deg === SENSOR_CALIBRATION.horizontal_fov_deg
    && sensors.camera_height_m === SENSOR_CALIBRATION.camera_height_m
    && sensors.camera_forward_offset_m === SENSOR_CALIBRATION.camera_forward_offset_m
    && sensors.image_order.length === 3
    && sensors.image_order[0] === 'rgb'
    && sensors.image_order[1] === 'thermal'
    && sensors.image_order[2] === 'depth'
    && depth.format === SENSOR_CALIBRATION.depth.format
    && depth.min_distance_m === SENSOR_CALIBRATION.depth.min_distance_m
    && depth.max_distance_m === SENSOR_CALIBRATION.depth.max_distance_m
    && depth.color_space === SENSOR_CALIBRATION.depth.color_space
    && depth.near_hue_deg === SENSOR_CALIBRATION.depth.near_hue_deg
    && depth.far_hue_deg === SENSOR_CALIBRATION.depth.far_hue_deg
    && depth.saturation === SENSOR_CALIBRATION.depth.saturation
    && depth.value === SENSOR_CALIBRATION.depth.value
    && depth.formula === SENSOR_CALIBRATION.depth.formula
    && JSON.stringify(depth.near_rgb) === JSON.stringify(SENSOR_CALIBRATION.depth.near_rgb)
    && JSON.stringify(depth.range_limit_rgb) === JSON.stringify(SENSOR_CALIBRATION.depth.range_limit_rgb)
    && JSON.stringify(depth.no_return_rgb) === JSON.stringify(SENSOR_CALIBRATION.depth.no_return_rgb);
}

const ImageBase64 = z.string()
  .min(1)
  .max(3_000_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64 without a data-URL prefix');

const RequestSchema = z.object({
  packet: z.custom<ObservationPacket>(isObservationPacket, 'invalid sensor packet'),
  rgb: ImageBase64.regex(/^\/9j\//, 'must contain a JPEG image'),
  thermal: ImageBase64.regex(/^\/9j\//, 'must contain a JPEG image'),
  depth: ImageBase64.regex(/^iVBORw0KGgo/, 'must contain a PNG image'),
  budget: z.number().optional(),
});

export async function POST(req: Request) {
  const url = new URL(req.url);
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: `bad request: ${(e as Error).message}` }, { status: 400 });
  }

  const forceMock = url.searchParams.get('mock') === '1' || process.env.DECIDER === 'mock';
  const useMock = forceMock || !hasGeminiKey();

  if (useMock) {
    const t0 = Date.now();
    const decision = DecisionSchema.parse(mockDecide(body.packet));
    // small artificial latency so the "waiting" state is visible in the UI
    await new Promise((r) => setTimeout(r, 150));
    const res: DecideResponse = {
      decision,
      thoughtSummary: 'Mock fixture: no model call. It does not interpret sensor images.',
      model: null,
      latencyMs: Date.now() - t0,
      tokens: { input: 0, output: 0, total: 0 },
      source: 'mock',
    };
    return NextResponse.json(res);
  }

  try {
    const r = await geminiDecide(body.packet, body.rgb, body.thermal, body.depth, body.budget ?? DECISION_BUDGET);
    const res: DecideResponse = {
      decision: DecisionSchema.parse(r.decision),
      thoughtSummary: r.thoughtSummary,
      model: r.model,
      latencyMs: r.latencyMs,
      tokens: r.tokens,
      source: 'gemini',
    };
    return NextResponse.json(res);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error('[api/decide] gemini failure:', msg);
    const rawStatus = Number((e as { status?: unknown; code?: unknown })?.status ?? (e as { code?: unknown })?.code);
    const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : /429|RESOURCE_EXHAUSTED/.test(msg) ? 429 : 502;
    return NextResponse.json({ error: msg, source: 'gemini' }, { status });
  }
}
