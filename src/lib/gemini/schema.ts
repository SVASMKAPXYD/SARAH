/** Shared API, mock, manual-console, and replay schemas; safe to import on clients. */
import { z } from 'zod';

export const MEMORY_MAX_CHARS = 24_000;

export const DecisionSchema = z.object({
  bearing_deg: z.number().min(0).max(360),
  distance_m: z.number().min(0).max(15),
  reason: z.string().min(1).max(500),
  mark_survivor: z.boolean().optional(),
  replace_entire_memory: z.string().max(MEMORY_MAX_CHARS),
}).strict();

export type Decision = z.infer<typeof DecisionSchema>;

/** Minimal movement response; every decision supplies the complete replacement memory. */
export const DecisionJsonSchema = {
  type: 'object',
  properties: {
    bearing_deg: { type: 'number', minimum: 0, maximum: 360, description: 'Absolute compass bearing; 0 is north and clockwise is positive.' },
    distance_m: { type: 'number', minimum: 0, maximum: 15, description: 'Distance to travel; zero turns in place.' },
    reason: { type: 'string', description: 'Brief reason for this movement.' },
    mark_survivor: { type: 'boolean', description: 'Optional. If true, mark the current position and do not move this turn.' },
    replace_entire_memory: {
      type: 'string',
      description: 'REQUIRED: The complete new contents of SARAH memory after this decision. This OVERWRITES the entire current memory file. Return the old memory in full, preserving useful information, plus any changes. Never return only new notes, an append, a patch, or instructions. To keep memory unchanged, copy the complete input memory exactly. Empty string intentionally clears memory. Maximum 24000 characters.',
    },
  },
  required: ['bearing_deg', 'distance_m', 'reason', 'replace_entire_memory'],
} as const;

// ---------------------------------------------------------------------------
// TerrainParams (plan §4) plus the qualitative manipulator fields.
// ---------------------------------------------------------------------------

/** Clamp a model number into an inclusive range, rounding counts. */
function unit() {
  return z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : v), z.number().min(0).max(1));
}
const fixedZero = z.preprocess(() => 0, z.literal(0));
function count(max: number) {
  return z.preprocess(
    (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : v),
    z.number().int().min(0).max(max),
  );
}

export const SurvivorSituationSchema = z.enum(['seated', 'ditch', 'slope', 'obstacle']);
export type SurvivorSituation = z.infer<typeof SurvivorSituationSchema>;

export const TerrainParamsSchema = z.object({
  tree_density: unit(),
  slope: fixedZero,
  fallen_logs: unit(),
  water: z.enum(['none', 'creek', 'pond']),
  fog_density: unit(),
  moonlight: unit(),
  /** 0 night, ~0.45 evening, 1 day. Intermediate values are dawn, dusk, overcast. */
  light_level: unit(),
  /** High-frequency ground roughness. Independent of `slope` (large hills). */
  bumpiness: fixedZero,
  fox_count: count(4),
  deer_count: count(4),
  /** Cars driving the trails. */
  car_count: count(4),
  fungi_patches: count(3),
  branchiness: unit(),
  survivor_situation: SurvivorSituationSchema,
  seed: z.preprocess((v) => (v === null ? undefined : v), z.number().optional()),
  narration: z.string(),
});

export type TerrainParams = z.infer<typeof TerrainParamsSchema>;

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
  tree_density: 0.5,
  slope: 0,
  fallen_logs: 0.4,
  water: 'creek',
  fog_density: 0.5,
  moonlight: 0.55,
  light_level: 0.12,
  bumpiness: 0,
  fox_count: 1,
  deer_count: 1,
  car_count: 0,
  fungi_patches: 2,
  branchiness: 0.5,
  survivor_situation: 'seated',
  narration: 'A moonlit pine forest with a creek, light fog, one fox, one deer and a few glowing fungi.',
};

/** Fill fields older replays do not have, then validate. */
export function parseTerrainParams(raw: unknown): TerrainParams {
  const extra = raw && typeof raw === 'object' ? (raw as object) : {};
  return TerrainParamsSchema.parse({ ...DEFAULT_TERRAIN_PARAMS, ...extra });
}

/** Short label for the light-level readout. */
export function describeLight(level: number): string {
  if (level >= 0.8) return 'day';
  if (level >= 0.55) return 'afternoon';
  if (level >= 0.28) return 'evening';
  return 'night';
}

export const TerrainParamsJsonSchema = {
  type: 'object',
  properties: {
    tree_density: { type: 'number', description: 'Vegetation. 0 sparse, 1 dense pines. 0..1' },
    slope: { type: 'number', description: 'Fixed at 0. Do not change.' },
    fallen_logs: { type: 'number', description: '0..1' },
    water: { type: 'string', enum: ['none', 'creek', 'pond'] },
    fog_density: { type: 'number', description: 'Weather and visibility. 0 clear, 1 thick fog. 0..1' },
    moonlight: { type: 'number', description: 'Extra night illumination. Keep low in daytime, higher at night. 0..1' },
    light_level: {
      type: 'number',
      description:
        'Time of day as brightness. 0 night, 0.45 evening or dusk, 1 full day. Use values in between for dawn, twilight, or an overcast afternoon. Change this whenever the operator mentions day, evening, night, dusk, or dawn.',
    },
    bumpiness: {
      type: 'number',
      description: 'Fixed at 0. Do not change.',
    },
    fox_count: { type: 'integer', description: '0..4 moving foxes. Raise when the operator adds animals or wildlife.' },
    deer_count: { type: 'integer', description: '0..4 moving deer. Raise when the operator adds animals or wildlife.' },
    car_count: { type: 'integer', description: '0..4 cars driving the trails. Increase to add cars or vehicles. 0 to remove them.' },
    fungi_patches: { type: 'integer', description: '0..3' },
    branchiness: { type: 'number', description: '0..1' },
    survivor_situation: {
      type: 'string',
      enum: ['seated', 'ditch', 'slope', 'obstacle'],
      description:
        'Where the missing person is. seated = sitting against a log. ditch = stuck in a ditch, gully, or trench. slope = on a steep bank. obstacle = pinned against a rock or log.',
    },
    seed: { type: 'number' },
    narration: {
      type: 'string',
      description:
        'One short confirmation of what changed, in plain language. Example: "Evening, bumpier ground, survivor in a ditch, cars and moving animals added."',
    },
  },
  required: [
    'tree_density',
    'slope',
    'fallen_logs',
    'water',
    'fog_density',
    'moonlight',
    'light_level',
    'bumpiness',
    'fox_count',
    'deer_count',
    'car_count',
    'fungi_patches',
    'branchiness',
    'survivor_situation',
    'narration',
  ],
} as const;
