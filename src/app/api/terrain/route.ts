/**
 * POST /api/terrain  { prompt, current?: TerrainParams } → { params: TerrainParams, source }
 * Gemini (structured output) when a key is present, otherwise a keyword mock.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { geminiTerrain, hasGeminiKey } from '@/lib/gemini/client';
import { mockTerrain } from '@/lib/gemini/mock';
import { DEFAULT_TERRAIN_PARAMS, TerrainParamsSchema } from '@/lib/gemini/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  prompt: z.string().default(''),
  current: TerrainParamsSchema.optional(),
});

export async function POST(req: Request) {
  const url = new URL(req.url);
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: `bad request: ${(e as Error).message}` }, { status: 400 });
  }
  const current = body.current ?? DEFAULT_TERRAIN_PARAMS;
  const useMock = url.searchParams.get('mock') === '1' || process.env.DECIDER === 'mock' || !hasGeminiKey();

  if (useMock) {
    return NextResponse.json({ params: TerrainParamsSchema.parse(mockTerrain(body.prompt, current)), source: 'mock', latencyMs: 0 });
  }
  try {
    const r = await geminiTerrain(body.prompt, current);
    return NextResponse.json({ params: r.params, source: 'gemini', latencyMs: r.latencyMs });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error('[api/terrain] gemini failure:', msg);
    return NextResponse.json({ error: msg, source: 'gemini' }, { status: 502 });
  }
}
