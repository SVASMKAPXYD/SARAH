import { DECISION_BUDGET, WORLD_HALF_SIZE_M } from '../constants.ts';
import { round } from '../geo.ts';
import type { ObservationPacket, Phase, SearchGuidance } from '../types';
import { SENSOR_CALIBRATION } from './depth.ts';

export interface PacketInputs {
  phase: Phase;
  step: number;
  decisionsUsed: number;
  distanceTraveledM: number;
  pose: { x: number; z: number; headingDeg: number };
  memory: string;
  lastResult: string;
  budget?: number;
  guidance?: SearchGuidance;
}

export function buildPacket(i: PacketInputs): ObservationPacket {
  const budget = i.budget ?? DECISION_BUDGET;
  return {
    world: {
      width_m: WORLD_HALF_SIZE_M * 2,
      height_m: WORLD_HALF_SIZE_M * 2,
      bounds_m: {
        min_x: -WORLD_HALF_SIZE_M,
        max_x: WORLD_HALF_SIZE_M,
        min_z: -WORLD_HALF_SIZE_M,
        max_z: WORLD_HALF_SIZE_M,
      },
      base: { x: 0, z: 0 },
    },
    mission: {
      phase: i.phase,
      step: i.step,
      decisions_remaining: Math.max(0, budget - i.decisionsUsed),
      distance_traveled_m: round(i.distanceTraveledM),
    },
    pose: {
      x: round(i.pose.x),
      z: round(i.pose.z),
      heading_deg: Math.round(i.pose.headingDeg) % 360,
    },
    sensors: SENSOR_CALIBRATION,
    memory: i.memory,
    last_result: i.lastResult,
    ...(i.guidance ? { search_guidance: i.guidance } : {}),
  };
}
