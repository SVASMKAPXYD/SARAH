/**
 * P3/P2 — build the ObservationPacket (plan §4). Contains only what Gemini may know:
 * pose, LiDAR, the map Gemini authored, mission bookkeeping, last_result.
 * Never pass World.truth here.
 */
import { DECISION_BUDGET } from '../constants';
import { bearingDeg, distance, round } from '../geo';
import type { Assessment, LidarGrid, MapState, ObservationPacket, Phase } from '../types';

export interface PacketInputs {
  phase: Phase;
  step: number;
  decisionsUsed: number;
  distanceTraveledM: number;
  previousAssessment: Assessment;
  pose: { x: number; z: number; headingDeg: number };
  atNode: string | null;
  lidar: LidarGrid;
  map: MapState;
  lastResult: string;
  budget?: number;
}

export function buildPacket(i: PacketInputs): ObservationPacket {
  const budget = i.budget ?? DECISION_BUDGET;
  const rover = { x: i.pose.x, z: i.pose.z };
  return {
    mission: {
      phase: i.phase,
      step: i.step,
      decisions_remaining: Math.max(0, budget - i.decisionsUsed),
      distance_traveled_m: round(i.distanceTraveledM),
      previous_assessment: i.previousAssessment,
    },
    pose: { x: round(i.pose.x), z: round(i.pose.z), heading_deg: Math.round(i.pose.headingDeg) % 360, at_node: i.atNode },
    lidar: i.lidar,
    map: {
      nodes: i.map.nodes.map((n) => ({
        id: n.id,
        x: round(n.x),
        z: round(n.z),
        kind: n.kind,
        visited: n.visited,
        ...(n.note ? { note: n.note } : {}),
        ...(n.lastAssessment ? { last_assessment: n.lastAssessment } : {}),
        ...(n.thermalScore !== undefined ? { thermal_score: n.thermalScore } : {}),
        ...(n.rgbPersonScore !== undefined ? { rgb_person_score: n.rgbPersonScore } : {}),
        bearing_from_rover_deg: Math.round(bearingDeg(rover, n)),
        distance_m: round(distance(rover, n)),
      })),
      edges: i.map.edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        length_m: round(e.lengthM),
        bearing_deg: Math.round(e.bearingDeg),
        safe: e.safe,
        ...(e.terrain ? { terrain: e.terrain } : {}),
        hazard_cost: e.hazardCost,
      })),
      frontiers: i.map.frontiers.map((f) => ({
        id: f.id,
        from_node: f.fromNode,
        bearing_deg: Math.round(f.bearingDeg),
        estimated_distance_m: round(f.estimatedDistanceM),
        geometry: f.geometry,
        status: f.status,
        ...(f.note ? { note: f.note } : {}),
      })),
    },
    last_result: i.lastResult,
  };
}
