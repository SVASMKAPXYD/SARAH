/**
 * P2 — server-only Gemini client (plan §3a, §3f).
 *
 * Uses the @google/genai Interactions API (`ai.interactions.create`) with:
 *   input: [rgb image, thermal image, packet JSON as text]
 *   response_format: DecisionJsonSchema (structured output)
 *   generation_config: { thinking_level: "low", thinking_summaries: "auto" }
 *   media_resolution: "low" (per image part)
 *
 * The API key lives only in GEMINI_API_KEY. Never import this file from client code.
 * TODO(P2): verify field names against ai.google.dev once a live key is available
 *           (Interactions API shape checked against @google/genai 2.27 typings).
 */
import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { DECISION_BUDGET } from '../constants';
import type { Decision, ObservationPacket, TerrainParams } from '../types';
import { buildSystemInstruction, TERRAIN_INSTRUCTION } from './prompt';
import {
  DecisionJsonSchema,
  DecisionSchema,
  TerrainParamsJsonSchema,
  TerrainParamsSchema,
} from './schema';

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';

export interface GeminiDecideResult {
  decision: Decision;
  thoughtSummary: string;
  latencyMs: number;
  tokens: { input: number; output: number; total: number };
  raw?: string;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

// --- Interactions API input types (structural; keeps us independent of SDK internals) ---
type ImageInput = { type: 'image'; data: string; mime_type: 'image/jpeg'; resolution?: 'low' | 'medium' | 'high' };
type TextInput = { type: 'text'; text: string };

interface InteractionLike {
  output_text?: string;
  steps?: Array<{
    type: string;
    summary?: Array<{ type: string; text?: string }>;
    content?: Array<{ type: string; text?: string }>;
  }>;
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_tokens?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string };
  const status = e?.status ?? e?.code;
  if (typeof status === 'number') return status === 429 || status >= 500;
  const msg = String(e?.message ?? '');
  return /429|RESOURCE_EXHAUSTED|UNAVAILABLE|5\d\d|fetch failed|ECONNRESET/i.test(msg);
}

/** Exponential backoff on 429/5xx (plan §3f). */
async function withBackoff<T>(fn: () => Promise<T>, attempts = 4, baseMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      const delay = baseMs * 2 ** i + Math.random() * 250;
      console.warn(`[gemini] retryable error, backing off ${Math.round(delay)}ms:`, (err as Error)?.message);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function extractThoughtSummary(interaction: InteractionLike): string {
  const parts: string[] = [];
  for (const step of interaction.steps ?? []) {
    if (step.type === 'thought') {
      for (const s of step.summary ?? []) if (s.type === 'text' && s.text) parts.push(s.text);
    }
  }
  return parts.join('\n').trim();
}

function extractOutputText(interaction: InteractionLike): string {
  if (interaction.output_text) return interaction.output_text;
  const parts: string[] = [];
  for (const step of interaction.steps ?? []) {
    if (step.type === 'model_output') {
      for (const c of step.content ?? []) if (c.type === 'text' && c.text) parts.push(c.text);
    }
  }
  return parts.join('');
}

function extractTokens(interaction: InteractionLike) {
  const u = interaction.usage ?? {};
  const input = u.total_input_tokens ?? 0;
  const output = u.total_output_tokens ?? 0;
  return { input, output, total: u.total_tokens ?? input + output };
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

async function structuredCall(args: {
  system: string;
  input: Array<ImageInput | TextInput>;
  schema: Record<string, unknown>;
}): Promise<{ text: string; thought: string; tokens: GeminiDecideResult['tokens'] }> {
  const ai = getClient();
  const interaction = (await withBackoff(() =>
    ai.interactions.create({
      model: GEMINI_MODEL,
      system_instruction: args.system,
      input: args.input,
      response_format: { type: 'text', mime_type: 'application/json', schema: args.schema },
      generation_config: { thinking_level: 'low', thinking_summaries: 'auto' },
      store: false,
    }),
  )) as unknown as InteractionLike;
  return {
    text: stripFences(extractOutputText(interaction)),
    thought: extractThoughtSummary(interaction),
    tokens: extractTokens(interaction),
  };
}

/**
 * One decision: images + packet → Decision. One retry on parse failure with the
 * zod error appended to the input (plan §3f). No local decision is ever substituted.
 */
export async function geminiDecide(
  packet: ObservationPacket,
  rgbB64: string,
  thermalB64: string,
  budget: number = DECISION_BUDGET,
): Promise<GeminiDecideResult> {
  const t0 = Date.now();
  const system = buildSystemInstruction(budget);
  const baseInput: Array<ImageInput | TextInput> = [
    { type: 'image', data: rgbB64, mime_type: 'image/jpeg', resolution: 'low' },
    { type: 'image', data: thermalB64, mime_type: 'image/jpeg', resolution: 'low' },
    { type: 'text', text: `RGB image first, aligned thermal image second. Observation packet:\n${JSON.stringify(packet)}` },
  ];

  let lastError = '';
  let tokens = { input: 0, output: 0, total: 0 };
  let thought = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const input =
      attempt === 0
        ? baseInput
        : [...baseInput, { type: 'text' as const, text: `Your previous output failed validation: ${lastError}. Return JSON matching the schema exactly.` }];
    const res = await structuredCall({ system, input, schema: DecisionJsonSchema as unknown as Record<string, unknown> });
    tokens = { input: tokens.input + res.tokens.input, output: tokens.output + res.tokens.output, total: tokens.total + res.tokens.total };
    thought = res.thought || thought;
    try {
      const parsed = DecisionSchema.safeParse(JSON.parse(res.text));
      if (parsed.success) {
        return { decision: parsed.data, thoughtSummary: thought, latencyMs: Date.now() - t0, tokens, raw: res.text };
      }
      lastError = parsed.error.message.slice(0, 600);
    } catch (e) {
      lastError = `invalid JSON: ${(e as Error).message}`.slice(0, 600);
    }
    console.warn(`[gemini] decision parse failure (attempt ${attempt + 1}): ${lastError}`);
  }
  throw new Error(`Gemini returned unparseable output twice: ${lastError}`);
}

/** Terrain chat: sentence → TerrainParams (plan §4). */
export async function geminiTerrain(prompt: string, current?: TerrainParams): Promise<{ params: TerrainParams; latencyMs: number }> {
  const t0 = Date.now();
  const input: TextInput[] = [
    { type: 'text', text: `Current params: ${JSON.stringify(current ?? {})}\nOperator: ${prompt}` },
  ];
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await structuredCall({
      system: TERRAIN_INSTRUCTION,
      input: attempt === 0 ? input : [...input, { type: 'text', text: `Previous output failed validation: ${lastError}` }],
      schema: TerrainParamsJsonSchema as unknown as Record<string, unknown>,
    });
    try {
      const parsed = TerrainParamsSchema.safeParse(JSON.parse(res.text));
      if (parsed.success) return { params: parsed.data, latencyMs: Date.now() - t0 };
      lastError = parsed.error.message.slice(0, 400);
    } catch (e) {
      lastError = `invalid JSON: ${(e as Error).message}`;
    }
  }
  throw new Error(`Gemini terrain output unparseable: ${lastError}`);
}
