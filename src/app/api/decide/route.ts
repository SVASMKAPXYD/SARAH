/**
 * POST /api/decide  { packet, rgb: base64 jpeg, thermal: base64 jpeg }
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
import type { DecideResponse, ObservationPacket } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  packet: z.custom<ObservationPacket>((v) => typeof v === 'object' && v !== null && 'lidar' in (v as object) && 'pose' in (v as object)),
  rgb: z.string().default(''),
  thermal: z.string().default(''),
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
      thoughtSummary: 'Mock decider: no model call. Steering toward the clearest LiDAR column.',
      model: null,
      latencyMs: Date.now() - t0,
      tokens: { input: 0, output: 0, total: 0 },
      source: 'mock',
    };
    return NextResponse.json(res);
  }

  try {
    const r = await geminiDecide(body.packet, body.rgb, body.thermal, body.budget ?? DECISION_BUDGET);
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
