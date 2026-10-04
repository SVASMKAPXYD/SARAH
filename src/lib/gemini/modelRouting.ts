/** Models are ordered by preferred speed; no non-Flash-Lite fallback is used. */
export const GEMINI_MODEL_PREFERENCE = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
] as const;

const unavailableModels = new Set<string>();

export function preferredAvailableModels(): string[] {
  return GEMINI_MODEL_PREFERENCE.filter((model) => !unavailableModels.has(model));
}

export function rememberUnavailableModel(model: string): void {
  unavailableModels.add(model);
}

function stringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Return a reason only when switching model can plausibly resolve the failure.
 * Unknown 429s deliberately stop rather than masking project-wide quota/billing.
 */
export function modelFallbackReason(error: unknown, model: string): string | null {
  const e = error as { status?: unknown; code?: unknown; details?: unknown; errorDetails?: unknown };
  const status = Number(e?.status ?? e?.code);
  const text = `${error instanceof Error ? error.message : stringify(error)} ${stringify(e?.details)} ${stringify(e?.errorDetails)}`;

  if (status === 503 || /\bUNAVAILABLE\b/i.test(text)) return 'model temporarily unavailable';
  if (
    status === 404 &&
    /model.{0,100}(not found|not supported|does not exist|not available)|(not found|not supported|does not exist|not available).{0,100}model/i.test(text)
  ) {
    return 'model unavailable to this API/project';
  }
  if (status !== 429 && !/\bRESOURCE_EXHAUSTED\b/i.test(text)) return null;

  const compact = text.replace(/[\s_-]/g, '').toLowerCase();
  if (/perprojectpermodel|permodel/.test(compact)) return 'model-specific quota exhausted';
  const modelMentioned = text.toLowerCase().includes(model.toLowerCase());
  if (modelMentioned && /quota|rate.?limit|requests?.{0,20}limit/i.test(text)) return 'model-specific quota exhausted';
  return null;
}
