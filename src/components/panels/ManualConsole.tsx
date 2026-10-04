'use client';
/**
 * P3/P4 — dev-only manual decision console (plan §2): submits the same Decision JSON
 * Gemini would, so the loop can be driven without /api/decide. Shown when
 * NEXT_PUBLIC_DEV_CONSOLE=1 or ?dev=1 (or via the Controls toggle). Set the decider to
 * "manual" and press Run; the loop waits here after every action.
 */
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useMission } from '@/hooks/useMission';
import type { Decision } from '@/lib/types';
import { useMissionStore } from '@/store/missionStore';

function template(partial: Partial<Decision> & { action: Decision['action'] }): Decision {
  return {
    observations: 'Manual decision.',
    map_update: { node_here: null, new_frontiers: [], frontier_updates: [], edge_annotation: null },
    survivor_assessment: 'NO_EVIDENCE',
    evidence: { thermal: 0, rgb_person: 0, bearing_deg: null },
    intent: 'EXPLORE_FRONTIER',
    confidence: 0.5,
    brief_reason: 'Operator-entered decision.',
    ...partial,
  };
}

export default function ManualConsole({ className = '' }: { className?: string }) {
  const { submitManualDecision, setDeciderMode, deciderMode, status } = useMission();
  const nodes = useMissionStore((s) => s.map.nodes);
  const lidar = useMissionStore((s) => s.lidar);
  const [text, setText] = useState(() => JSON.stringify(template({ action: { type: 'MOVE', turn_deg: 0, distance_m: 8 } }), null, 2));
  const [msg, setMsg] = useState<string | null>(null);

  const waiting = deciderMode === 'manual' && status === 'waiting_for_gemini';
  const centerM = lidar?.level['0'].m;

  const presets = useMemo(
    () => [
      { label: 'MOVE 8 m', d: template({ action: { type: 'MOVE', turn_deg: 0, distance_m: 8 } }) },
      { label: 'Turn +90°', d: template({ intent: 'SCAN', action: { type: 'MOVE', turn_deg: 90, distance_m: 0 } }) },
      {
        label: 'Node + frontier',
        d: template({
          map_update: {
            node_here: { kind: 'JUNCTION', note: 'manual junction' },
            new_frontiers: [{ bearing_deg: 45, estimated_distance_m: 12, geometry: 'CLEAR', note: 'manual frontier' }],
            frontier_updates: [],
            edge_annotation: { terrain: 'TRAIL', hazard_cost: 0 },
          },
          action: { type: 'MOVE', turn_deg: 45, distance_m: 10 },
        }),
      },
      { label: 'Return move (edit bearing)', d: template({ intent: 'RETURN_TO_BASE', action: { type: 'MOVE', turn_deg: 180, distance_m: 8 } }) },
      {
        label: 'CONFIRMED (no move)',
        d: template({
          survivor_assessment: 'CONFIRMED_CANDIDATE',
          evidence: { thermal: 0.95, rgb_person: 0.9, bearing_deg: 0 },
          intent: 'APPROACH_CANDIDATE',
          action: { type: 'MOVE', turn_deg: 0, distance_m: 0 },
        }),
      },
      {
        label: 'MARK_SURVIVOR',
        d: template({
          survivor_assessment: 'CONFIRMED_CANDIDATE',
          evidence: { thermal: 0.95, rgb_person: 0.9, bearing_deg: 0 },
          intent: 'MARK_SURVIVOR',
          action: { type: 'MARK_SURVIVOR' },
        }),
      },
    ],
    [],
  );

  const submit = () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      const r = submitManualDecision(parsed);
      setMsg(r.ok ? 'submitted' : r.error ?? 'rejected');
    } catch (e) {
      setMsg(`invalid JSON: ${(e as Error).message}`);
    }
  };

  return (
    <Card className={`border-violet-900/60 ${className}`}>
      <CardHeader
        title="Manual decision console (dev)"
        right={
          <div className="flex items-center gap-1.5">
            {waiting ? <Badge tone="violet">waiting for you</Badge> : <Badge tone="neutral">{deciderMode === 'manual' ? status : 'decider ≠ manual'}</Badge>}
            {deciderMode !== 'manual' && (
              <Button size="sm" variant="ghost" onClick={() => setDeciderMode('manual')} disabled={status === 'running' || status === 'waiting_for_gemini'}>
                use manual
              </Button>
            )}
          </div>
        }
      />
      <CardBody className="space-y-2 text-xs">
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <Button key={p.label} size="sm" variant="ghost" onClick={() => setText(JSON.stringify(p.d, null, 2))}>
              {p.label}
            </Button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={10}
          className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-[11px] leading-snug text-zinc-200"
        />
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={submit} disabled={!waiting}>
            Submit decision
          </Button>
          <span className="font-mono text-[10px] text-zinc-500">
            nodes: {nodes.map((n) => n.id).join(', ')} · center LiDAR {centerM === undefined ? '—' : centerM === null ? '>30' : `${centerM} m`}
          </span>
          {msg && <span className="ml-auto text-zinc-400">{msg}</span>}
        </div>
      </CardBody>
    </Card>
  );
}
