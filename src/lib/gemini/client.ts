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
 * TODO(P2): smoke-test the Interactions request against a live Gemini project.
 */
import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { DECISION_BUDGET } from '../constants';
import type { Decision, ObservationPacket, TerrainParams } from '../types';
import { buildSystemInstruction, TERRAIN_INSTRUCTION } from './prompt';
import { GEMINI_MODEL_PREFERENCE, modelFallbackReason, preferredAvailableModels, rememberUnavailableModel } from './modelRouting';
import {
  DecisionJsonSchema,
  DecisionSchema,
  TerrainParamsJsonSchema,
  TerrainParamsSchema,
} from './schema';

/** Free-tier Flash-Lite preference order: try the fastest/newest choice first. */
export { GEMINI_MODEL_PREFERENCE };

export interface GeminiDecideResult {
  decision: Decision;
  thoughtSummary: string;
  model: string;
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

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function combinedFailure(message: string, providerError: unknown, keepProviderStatus: boolean): Error {
  const error = new Error(message);
  const status = (providerError as { status?: unknown })?.status;
  if (keepProviderStatus && typeof status === 'number') Object.assign(error, { status });
  return error;
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
  model: string;
  system: string;
  input: Array<ImageInput | TextInput>;
  schema: Record<string, unknown>;
}): Promise<{ text: string; thought: string; tokens: GeminiDecideResult['tokens'] }> {
  const ai = getClient();
  const interaction = (await ai.interactions.create({
    model: args.model,
    system_instruction: args.system,
    input: args.input,
    response_format: { type: 'text', mime_type: 'application/json', schema: args.schema },
    generation_config: { thinking_level: 'low', thinking_summaries: 'auto' },
    store: false,
  })) as unknown as InteractionLike;
  return {
    text: stripFences(extractOutputText(interaction)),
    thought: extractThoughtSummary(interaction),
    tokens: extractTokens(interaction),
  };
}

/**
 * Each preferred model gets at most one schema-correction call. Model-specific
 * quota/availability failures advance to the next preference; other failures stop.
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
  let lastModelError: unknown;
  let lastFailureWasModelError = false;
  let tokens = { input: 0, output: 0, total: 0 };
  let thought = '';
  const models = preferredAvailableModels();
  if (models.length === 0) throw new Error('No configured Gemini Flash-Lite model is available; restart the server to retry model discovery.');
  for (const model of models) {
    let correction = '';
    let unavailableError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const input =
        attempt === 0
          ? baseInput
          : [...baseInput, { type: 'text' as const, text: `Your previous output failed validation: ${correction}. Return JSON matching the schema exactly.` }];
      let res: Awaited<ReturnType<typeof structuredCall>>;
      try {
        res = await structuredCall({ model, system, input, schema: DecisionJsonSchema as unknown as Record<string, unknown> });
      } catch (err) {
        if (!modelFallbackReason(err, model)) throw err;
        unavailableError = err;
        break;
      }
      tokens = { input: tokens.input + res.tokens.input, output: tokens.output + res.tokens.output, total: tokens.total + res.tokens.total };
      thought = res.thought || thought;
      try {
        const parsed = DecisionSchema.safeParse(JSON.parse(res.text));
        if (parsed.success) {
          return { decision: parsed.data, thoughtSummary: thought, model, latencyMs: Date.now() - t0, tokens, raw: res.text };
        }
        correction = parsed.error.message.slice(0, 600);
      } catch (err) {
        correction = `invalid JSON: ${errorText(err)}`.slice(0, 600);
      }
      console.warn(`[gemini] ${model} decision parse failure (attempt ${attempt + 1}): ${correction}`);
    }
    if (unavailableError) {
      lastModelError = unavailableError;
      lastFailureWasModelError = true;
      if (modelFallbackReason(unavailableError, model) === 'model unavailable to this API/project') rememberUnavailableModel(model);
      console.warn(`[gemini] ${model} unavailable (${modelFallbackReason(unavailableError, model)}); trying next preference`);
    } else if (correction) {
      lastError = `${model}: ${correction}`;
      lastFailureWasModelError = false;
    }
  }
  if (lastModelError && !lastError) throw lastModelError;
  if (lastModelError) {
    throw combinedFailure(
    `No preferred Gemini model returned a valid decision. Last model error: ${errorText(lastModelError)}; output error: ${lastError}`,
    lastModelError,
    lastFailureWasModelError,
    );
  }
  throw new Error(`Gemini returned unparseable output twice: ${lastError}`);
}

/** Terrain chat: sentence → TerrainParams (plan §4). */
export async function geminiTerrain(prompt: string, current?: TerrainParams): Promise<{ params: TerrainParams; model: string; latencyMs: number }> {
  const t0 = Date.now();
  const input: TextInput[] = [
    { type: 'text', text: `Current params: ${JSON.stringify(current ?? {})}\nOperator: ${prompt}` },
  ];
  let lastError = '';
  let lastModelError: unknown;
  let lastFailureWasModelError = false;
  const models = preferredAvailableModels();
  if (models.length === 0) throw new Error('No configured Gemini Flash-Lite model is available; restart the server to retry model discovery.');
  for (const model of models) {
    let correction = '';
    let unavailableError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Awaited<ReturnType<typeof structuredCall>>;
      try {
        res = await structuredCall({
          model,
          system: TERRAIN_INSTRUCTION,
          input: attempt === 0 ? input : [...input, { type: 'text', text: `Previous output failed validation: ${correction}` }],
          schema: TerrainParamsJsonSchema as unknown as Record<string, unknown>,
        });
      } catch (err) {
        if (!modelFallbackReason(err, model)) throw err;
        unavailableError = err;
        break;
      }
      try {
        const parsed = TerrainParamsSchema.safeParse(JSON.parse(res.text));
        if (parsed.success) return { params: parsed.data, model, latencyMs: Date.now() - t0 };
        correction = parsed.error.message.slice(0, 400);
      } catch (err) {
        correction = `invalid JSON: ${errorText(err)}`;
      }
    }
    if (unavailableError) {
      lastModelError = unavailableError;
      lastFailureWasModelError = true;
      if (modelFallbackReason(unavailableError, model) === 'model unavailable to this API/project') rememberUnavailableModel(model);
      console.warn(`[gemini] ${model} unavailable (${modelFallbackReason(unavailableError, model)}); trying next preference`);
    } else if (correction) {
      lastError = `${model}: ${correction}`;
      lastFailureWasModelError = false;
    }
  }
  if (lastModelError && !lastError) throw lastModelError;
  if (lastModelError) {
    throw combinedFailure(
      `No preferred Gemini model returned valid terrain. Last model error: ${errorText(lastModelError)}; output error: ${lastError}`,
      lastModelError,
      lastFailureWasModelError,
    );
  }
  throw new Error(`Gemini terrain output unparseable: ${lastError}`);
}
