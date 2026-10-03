import { NextResponse } from 'next/server';
import { DECISION_BUDGET } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const decider = process.env.DECIDER === 'mock' || !hasKey ? 'mock' : 'gemini';
  return NextResponse.json({
    ok: true,
    decider,
    model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
    budget: DECISION_BUDGET,
    time: new Date().toISOString(),
  });
}
