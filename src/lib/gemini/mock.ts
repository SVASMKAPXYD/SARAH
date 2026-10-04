/**
 * P2 — deterministic mock decider. Produces a valid Decision from the packet ALONE
 * (it never sees ground truth) so the P1/P3/P4 loop runs without a Gemini key.
 *
 * This offline fixture cannot inspect the RGB, thermal, or depth images. It produces a
 * deterministic action only so the local simulation can be exercised without Gemini.
 */
import { normDeg } from '../geo';
import type { Decision, ObservationPacket, TerrainParams } from '../types';
import { DEFAULT_TERRAIN_PARAMS, describeLight } from './schema';

export function mockDecide(packet: ObservationPacket): Decision {
  const step = packet.mission.step;
  const blocked = /^BLOCKED/.test(packet.last_result);
  const turn = blocked ? (step % 2 === 0 ? 90 : -90) : step % 4 === 1 ? 45 : step % 4 === 3 ? -45 : 0;
  const distance = blocked ? 0 : 6;
  return {
    bearing_deg: normDeg(packet.pose.heading_deg + turn),
    distance_m: distance,
    reason: blocked
      ? `Offline fixture turns after a collision; it does not analyze sensor images.`
      : `Offline fixture moves ${distance} m; it does not analyze sensor images.`,
    replace_entire_memory: packet.memory,
  };
}

function clampCount(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(n)));
}

function situationPhrase(s: TerrainParams['survivor_situation']): string {
  if (s === 'ditch') return 'survivor in a ditch';
  if (s === 'slope') return 'survivor on a slope';
  if (s === 'obstacle') return 'survivor against an obstacle';
  return 'survivor seated by a log';
}

/** One-line confirmation of fields that moved. Used when Gemini is not called. */
function confirmTerrain(prev: TerrainParams, out: TerrainParams): string {
  const bits: string[] = [];
  if (Math.abs(out.light_level - prev.light_level) > 0.05) bits.push(describeLight(out.light_level));
  if (out.survivor_situation !== prev.survivor_situation) bits.push(situationPhrase(out.survivor_situation));
  if (out.car_count > prev.car_count) bits.push(out.car_count === 1 ? 'a car added' : 'cars added');
  else if (out.car_count < prev.car_count) bits.push('cars removed');
  const animals = out.fox_count + out.deer_count;
  const prevAnimals = prev.fox_count + prev.deer_count;
  if (animals > prevAnimals) bits.push('moving animals added');
  else if (animals < prevAnimals) bits.push('fewer animals');
  if (out.fog_density > prev.fog_density + 0.08) bits.push('thicker fog');
  else if (out.fog_density < prev.fog_density - 0.08) bits.push('clearer air');
  if (out.tree_density > prev.tree_density + 0.08) bits.push('denser trees');
  else if (out.tree_density < prev.tree_density - 0.08) bits.push('sparser trees');
  if (out.water !== prev.water) bits.push(out.water === 'none' ? 'no water' : `a ${out.water}`);
  if (!bits.length) bits.push('terrain unchanged');
  const line = bits.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Terrain mock: nudge supported params from keywords. Gemini is the real mapper. */
export function mockTerrain(prompt: string, current: TerrainParams = DEFAULT_TERRAIN_PARAMS): TerrainParams {
  const p = prompt.toLowerCase();
  const prev: TerrainParams = { ...current };
  const out: TerrainParams = { ...current };
  const bump = (k: keyof TerrainParams, d: number) => {
    const v = out[k];
    if (typeof v === 'number') (out as Record<string, unknown>)[k] = Math.max(0, Math.min(1, v + d));
  };
  if (/dense|thick|more trees|pines?/.test(p)) bump('tree_density', 0.3);
  if (/sparse|open|clearing|fewer trees/.test(p)) bump('tree_density', -0.3);
  if (/creek|stream|river/.test(p)) out.water = 'creek';
  if (/pond|lake/.test(p)) out.water = 'pond';
  if (/dry|no water/.test(p)) out.water = 'none';
  if (/heavy fog|thick fog|foggy/.test(p)) bump('fog_density', 0.3);
  else if (/light fog|thin fog/.test(p)) out.fog_density = 0.3;
  else if (/fog|mist|visibility/.test(p)) bump('fog_density', 0.2);
  if (/clear sky|no fog|clear air/.test(p)) out.fog_density = 0.05;
  if (/evening|dusk|sunset|twilight/.test(p)) {
    out.light_level = 0.42;
    out.moonlight = 0.35;
  } else if (/night|midnight|after dark|moonlit/.test(p)) {
    out.light_level = 0.08;
    out.moonlight = 0.7;
  } else if (/dawn|sunrise/.test(p)) {
    out.light_level = 0.3;
    out.moonlight = 0.25;
  } else if (/daytime|day time|\bday\b|noon|midday|sunny|sunlight|morning|afternoon/.test(p)) {
    out.light_level = 0.95;
    out.moonlight = 0.12;
  }
  if (/bright|full moon/.test(p)) bump('moonlight', 0.3);
  if (/new moon/.test(p)) bump('moonlight', -0.3);
  if (/logs?|deadfall|windfall/.test(p)) bump('fallen_logs', 0.3);
  if (/branch|maze|forks?|many trails/.test(p)) bump('branchiness', 0.3);
  if (/\bno cars\b|without cars|remove cars/.test(p)) out.car_count = 0;
  else if (/\bcars?\b|vehicles?|trucks?|automobiles?/.test(p)) out.car_count = clampCount(Math.max(2, out.car_count + 2), 4);
  if (/\bno animals\b|without animals|no wildlife/.test(p)) {
    out.fox_count = 0;
    out.deer_count = 0;
  } else if (/moving animals|animals|wildlife|creatures/.test(p)) {
    out.fox_count = clampCount(Math.max(2, out.fox_count), 4);
    out.deer_count = clampCount(Math.max(2, out.deer_count), 4);
  }
  const foxM = p.match(/(\d|no|two|one)\s+fox/);
  if (foxM) out.fox_count = foxM[1] === 'no' ? 0 : foxM[1] === 'two' ? 2 : foxM[1] === 'one' ? 1 : clampCount(Number(foxM[1]), 4);
  const deerM = p.match(/(\d|no|two|one)\s+deer/);
  if (deerM) out.deer_count = deerM[1] === 'no' ? 0 : deerM[1] === 'two' ? 2 : deerM[1] === 'one' ? 1 : clampCount(Number(deerM[1]), 4);
  if (/ditch|gully|ravine|trench/.test(p)) out.survivor_situation = 'ditch';
  else if (/obstacle|pinned|wedged|against a (rock|log|boulder)/.test(p)) out.survivor_situation = 'obstacle';
  else if (/on a slope|steep bank|hillside/.test(p)) out.survivor_situation = 'slope';
  else if (/seated|sitting|against a log/.test(p)) out.survivor_situation = 'seated';
  if (/fung|mushroom|glow/.test(p)) out.fungi_patches = Math.min(3, out.fungi_patches + 1);
  const seedM = p.match(/seed\s*(\d+)/);
  if (seedM) out.seed = Number(seedM[1]);
  out.narration = confirmTerrain(prev, out);
  return out;
}
