import { NextResponse } from 'next/server';
import { DECISION_BUDGET } from '@/lib/constants';
import { GEMINI_MODEL_PREFERENCE } from '@/lib/gemini/modelRouting';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const decider = process.env.DECIDER === 'mock' || !hasKey ? 'mock' : 'gemini';
  return NextResponse.json({
    ok: true,
    decider,
    modelPreference: GEMINI_MODEL_PREFERENCE,
    budget: DECISION_BUDGET,
    time: new Date().toISOString(),
  });
}
