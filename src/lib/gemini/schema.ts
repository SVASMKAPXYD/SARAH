/**
 * P2 — Decision and TerrainParams schemas (plan §4). Shared by the API, the mock,
 * the manual console and the replay player. Safe to import on the client (no SDK).
 */
import { z } from 'zod';

export const NodeKindSchema = z.enum(['JUNCTION', 'VIEWPOINT', 'DEAD_END', 'EVIDENCE', 'SURVIVOR']);
export const FrontierGeometrySchema = z.enum(['CLEAR', 'NARROW', 'UNCERTAIN']);
export const FrontierUpdateStatusSchema = z.enum(['TRAVERSED', 'BLOCKED']);
export const TerrainKindSchema = z.enum(['TRAIL', 'FOREST', 'SLOPE', 'BRIDGE']);
export const AssessmentSchema = z.enum(['NO_EVIDENCE', 'POSSIBLE', 'LIKELY', 'CONFIRMED_CANDIDATE']);
export const IntentSchema = z.enum([
  'EXPLORE_FRONTIER',
  'FOLLOW_KNOWN_ROUTE',
  'INVESTIGATE_THERMAL_LEAD',
  'SCAN',
  'APPROACH_CANDIDATE',
  'MARK_SURVIVOR',
  'RETURN_TO_BASE',
]);
export const ActionTypeSchema = z.enum(['MOVE', 'GOTO_NODE', 'MARK_SURVIVOR', 'RETURN_TO_BASE']);

export const MapUpdateSchema = z.object({
  node_here: z.object({ kind: NodeKindSchema, note: z.string() }).nullable(),
  new_frontiers: z.array(
    z.object({
      bearing_deg: z.number(),
      estimated_distance_m: z.number(),
      geometry: FrontierGeometrySchema,
      note: z.string(),
    }),
  ),
  frontier_updates: z.array(z.object({ id: z.string(), status: FrontierUpdateStatusSchema })),
  edge_annotation: z.object({ terrain: TerrainKindSchema, hazard_cost: z.number() }).nullable(),
});

export const ActionSchema = z.object({
  type: ActionTypeSchema,
  turn_deg: z.number().optional(),
  distance_m: z.number().optional(),
  node_id: z.string().optional(),
});

export const DecisionSchema = z.object({
  observations: z.string(),
  map_update: MapUpdateSchema,
  survivor_assessment: AssessmentSchema,
  evidence: z.object({
    thermal: z.number(),
    rgb_person: z.number(),
    bearing_deg: z.number().nullable(),
  }),
  intent: IntentSchema,
  action: ActionSchema,
  confidence: z.number(),
  brief_reason: z.string(),
});

export type Decision = z.infer<typeof DecisionSchema>;
export type MapUpdate = z.infer<typeof MapUpdateSchema>;
export type DecisionAction = z.infer<typeof ActionSchema>;

/**
 * JSON Schema for Gemini `response_format` — plan §4 "Decision schema", verbatim.
 */
export const DecisionJsonSchema = {
  type: 'object',
  properties: {
    observations: {
      type: 'string',
      description: 'Max 2 sentences: what RGB, thermal and the LiDAR grid jointly show, with bearings.',
    },
    map_update: {
      type: 'object',
      properties: {
        node_here: {
          type: ['object', 'null'],
          properties: {
            kind: { type: 'string', enum: ['JUNCTION', 'VIEWPOINT', 'DEAD_END', 'EVIDENCE', 'SURVIVOR'] },
            note: { type: 'string' },
          },
          required: ['kind', 'note'],
        },
        new_frontiers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              bearing_deg: { type: 'number' },
              estimated_distance_m: { type: 'number' },
              geometry: { type: 'string', enum: ['CLEAR', 'NARROW', 'UNCERTAIN'] },
              note: { type: 'string' },
            },
            required: ['bearing_deg', 'estimated_distance_m', 'geometry', 'note'],
          },
        },
        frontier_updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              status: { type: 'string', enum: ['TRAVERSED', 'BLOCKED'] },
            },
            required: ['id', 'status'],
          },
        },
        edge_annotation: {
          type: ['object', 'null'],
          properties: {
            terrain: { type: 'string', enum: ['TRAIL', 'FOREST', 'SLOPE', 'BRIDGE'] },
            hazard_cost: { type: 'number' },
          },
          required: ['terrain', 'hazard_cost'],
        },
      },
      required: ['node_here', 'new_frontiers', 'frontier_updates', 'edge_annotation'],
    },
    survivor_assessment: { type: 'string', enum: ['NO_EVIDENCE', 'POSSIBLE', 'LIKELY', 'CONFIRMED_CANDIDATE'] },
    evidence: {
      type: 'object',
      properties: {
        thermal: { type: 'number' },
        rgb_person: { type: 'number' },
        bearing_deg: { type: ['number', 'null'] },
      },
      required: ['thermal', 'rgb_person', 'bearing_deg'],
    },
    intent: {
      type: 'string',
      enum: [
        'EXPLORE_FRONTIER',
        'FOLLOW_KNOWN_ROUTE',
        'INVESTIGATE_THERMAL_LEAD',
        'SCAN',
        'APPROACH_CANDIDATE',
        'MARK_SURVIVOR',
        'RETURN_TO_BASE',
      ],
    },
    action: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['MOVE', 'GOTO_NODE', 'MARK_SURVIVOR', 'RETURN_TO_BASE'] },
        turn_deg: { type: 'number', description: 'MOVE only, -180..180, positive = right.' },
        distance_m: { type: 'number', description: 'MOVE only, 0..15. 0 = turn in place to look.' },
        node_id: { type: 'string', description: 'GOTO_NODE only; must be a node id in the map.' },
      },
      required: ['type'],
    },
    confidence: { type: 'number', description: '0..1 that this action advances the mission.' },
    brief_reason: { type: 'string', description: 'One sentence, first person, for the operator.' },
  },
  required: [
    'observations',
    'map_update',
    'survivor_assessment',
    'evidence',
    'intent',
    'action',
    'confidence',
    'brief_reason',
  ],
} as const;

// ---------------------------------------------------------------------------
// TerrainParams (plan §4) plus the qualitative manipulator fields.
// ---------------------------------------------------------------------------

/** Clamp a model number into an inclusive range, rounding counts. */
function unit() {
  return z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : v), z.number().min(0).max(1));
}
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
  slope: unit(),
  fallen_logs: unit(),
  water: z.enum(['none', 'creek', 'pond']),
  fog_density: unit(),
  moonlight: unit(),
  /** 0 night, ~0.45 evening, 1 day. Intermediate values are dawn, dusk, overcast. */
  light_level: unit(),
  /** High-frequency ground roughness. Independent of `slope` (large hills). */
  bumpiness: unit(),
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
  slope: 0.2,
  fallen_logs: 0.4,
  water: 'creek',
  fog_density: 0.5,
  moonlight: 0.55,
  light_level: 0.12,
  bumpiness: 0.15,
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
    slope: { type: 'number', description: 'Large hills. 0 flat, 1 steep. Independent of bumpiness. 0..1' },
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
      description:
        'Small-scale ground roughness. 0 smooth, 1 very bumpy or uneven. Raise for bumpy, rough, rocky, or rutted ground. Lower for smooth or flat. Not the same as slope.',
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
