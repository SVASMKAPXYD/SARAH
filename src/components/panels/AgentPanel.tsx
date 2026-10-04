'use client';
/**
 * P4 — agent panel (plan §2 "UI", spec §11): phase, Gemini's observations, map update
 * summary, action, survivor assessment, confidence, brief_reason, and a scrolling feed with
 * thought summaries. Shows the waiting-for-Gemini and error states explicitly.
 */
import { useEffect, useRef } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import type { Assessment, Decision, FeedEntry, Phase } from '@/lib/types';
import { useMissionStore } from '@/store/missionStore';

const PHASE_TONE: Record<Phase, BadgeTone> = {
  SEARCH: 'blue',
  INVESTIGATE: 'amber',
  CONFIRM: 'violet',
  RESCUE: 'green',
  EXTRACT: 'green',
  COMPLETE: 'green',
};
const ASSESS_TONE: Record<Assessment, BadgeTone> = {
  NO_EVIDENCE: 'neutral',
  POSSIBLE: 'amber',
  LIKELY: 'amber',
  CONFIRMED_CANDIDATE: 'green',
};

function actionLabel(d: Decision): string {
  const a = d.action;
  if (a.type === 'MOVE') {
    const turn = a.turn_deg ?? 0;
    return `MOVE  turn ${turn >= 0 ? '+' : ''}${turn}°  ·  ${a.distance_m ?? 0} m`;
  }
  if (a.type === 'GOTO_NODE') return `GOTO_NODE  ${a.node_id ?? '?'}`;
  return a.type;
}

function mapUpdateSummary(d: Decision): string {
  const u = d.map_update;
  const parts: string[] = [];
  if (u.node_here) parts.push(`node ${u.node_here.kind}: “${u.node_here.note}”`);
  if (u.new_frontiers.length) parts.push(`${u.new_frontiers.length} new frontier${u.new_frontiers.length > 1 ? 's' : ''} (${u.new_frontiers.map((f) => `${Math.round(f.bearing_deg)}°`).join(', ')})`);
  if (u.frontier_updates.length) parts.push(u.frontier_updates.map((f) => `${f.id}→${f.status}`).join(', '));
  if (u.edge_annotation) parts.push(`edge ${u.edge_annotation.terrain} (hazard ${u.edge_annotation.hazard_cost})`);
  return parts.length ? parts.join(' · ') : 'no map change';
}

export default function AgentPanel({ className = '' }: { className?: string }) {
  const status = useMissionStore((s) => s.status);
  const error = useMissionStore((s) => s.error);
  const phase = useMissionStore((s) => s.rover.phase);
  const step = useMissionStore((s) => s.rover.step);
  const decision = useMissionStore((s) => s.lastDecision);
  const thought = useMissionStore((s) => s.lastThought);
  const lastResult = useMissionStore((s) => s.lastResult);
  const lastSource = useMissionStore((s) => s.lastSource);
  const deciderMode = useMissionStore((s) => s.deciderMode);
  const feed = useMissionStore((s) => s.feed);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  const waiting = status === 'waiting_for_gemini';
  const waitingFor = deciderMode === 'manual' ? 'manual decision' : deciderMode === 'replay' ? 'replay' : lastSource === 'mock' ? 'mock decider' : 'Gemini';

  return (
    <Card className={`flex min-h-0 flex-col ${className}`}>
      <CardHeader
        title="Agent"
        right={
          <div className="flex items-center gap-1.5">
            <Badge tone={PHASE_TONE[phase]}>{phase}</Badge>
            <span className="font-mono text-[10px] text-zinc-500">step {step}</span>
          </div>
        }
      />
      <CardBody className="space-y-2 border-b border-zinc-800 text-xs">
        {waiting && (
          <div className="flex items-center gap-2 rounded border border-amber-700/50 bg-amber-900/30 px-2 py-1.5 text-amber-200">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            Waiting for {waitingFor}…
          </div>
        )}
        {error && (
          <div className="rounded border border-rose-700/60 bg-rose-900/30 px-2 py-1.5 text-rose-200">
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}
        {status === 'idle' && !decision && <p className="text-zinc-500">Press Run. Gemini (or the mock decider) will map and drive from here.</p>}
        {decision && (
          <>
            <Row label="Observations">
              <span className="text-zinc-200">{decision.observations}</span>
            </Row>
            <Row label="Map update">
              <span className="text-zinc-300">{mapUpdateSummary(decision)}</span>
            </Row>
            <Row label="Action">
              <span className="font-mono text-emerald-300">{actionLabel(decision)}</span>
              <Badge tone="neutral" className="ml-2">
                {decision.intent}
              </Badge>
            </Row>
            <Row label="Assessment">
              <Badge tone={ASSESS_TONE[decision.survivor_assessment]}>{decision.survivor_assessment}</Badge>
              <span className="ml-2 font-mono text-zinc-400">
                thermal {decision.evidence.thermal.toFixed(2)} · rgb {decision.evidence.rgb_person.toFixed(2)}
                {decision.evidence.bearing_deg !== null ? ` · @${Math.round(decision.evidence.bearing_deg)}°` : ''}
              </span>
            </Row>
            <Row label="Confidence">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-28 overflow-hidden rounded bg-zinc-800">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, decision.confidence)) * 100)}%` }} />
                </div>
                <span className="font-mono text-zinc-300">{decision.confidence.toFixed(2)}</span>
              </div>
            </Row>
            <Row label="Reason">
              <span className="italic text-zinc-200">“{decision.brief_reason}”</span>
            </Row>
            {thought && (
              <Row label="Thought">
                <span className="text-zinc-400">{thought}</span>
              </Row>
            )}
            <Row label="Last result">
              <span className="font-mono text-zinc-300">{lastResult}</span>
            </Row>
          </>
        )}
      </CardBody>
      <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-snug">
        {feed.length === 0 && <p className="text-zinc-600">feed is empty</p>}
        {feed.map((e) => (
          <FeedLine key={e.id} e={e} />
        ))}
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

const FEED_STYLE: Record<FeedEntry['kind'], string> = {
  decision: 'text-emerald-300',
  result: 'text-zinc-300',
  system: 'text-zinc-500',
  error: 'text-rose-300',
  thought: 'text-violet-300',
};

function FeedLine({ e }: { e: FeedEntry }) {
  return (
    <div className={`flex gap-2 py-0.5 ${FEED_STYLE[e.kind]}`}>
      <span className="shrink-0 text-zinc-600">{String(e.step).padStart(2, '0')}</span>
      <span className="min-w-0 break-words">
        {e.kind === 'thought' && <span className="text-violet-500">💭 </span>}
        {e.text}
        {e.kind === 'decision' && e.latencyMs !== undefined && e.latencyMs > 0 && <span className="text-zinc-600"> ({e.latencyMs} ms{e.source ? `, ${e.source}` : ''})</span>}
      </span>
    </div>
  );
}
