/**
 * POST /api/terrain  { prompt, current?: TerrainParams } → { params: TerrainParams, source }
 * Gemini structured output maps the sentence onto TerrainParams. The keyword mock is used
 * only when GEMINI_API_KEY is missing or `?mock=1` is set. DECIDER=mock does not apply here:
 * that flag is for /api/decide. A Gemini failure is returned as an error, not rewritten as mock.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { geminiTerrain, hasGeminiKey } from '@/lib/gemini/client';
import { mockTerrain } from '@/lib/gemini/mock';
import { DEFAULT_TERRAIN_PARAMS, parseTerrainParams, TerrainParamsSchema } from '@/lib/gemini/schema';

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
  const current = body.current ? parseTerrainParams(body.current) : DEFAULT_TERRAIN_PARAMS;
  const useMock = url.searchParams.get('mock') === '1' || !hasGeminiKey();

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
