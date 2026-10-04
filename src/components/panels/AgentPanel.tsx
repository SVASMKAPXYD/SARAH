'use client';
/** Live movement, reason, persistent memory, and decision feed for the agent. */
import { useEffect, useRef } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import type { FeedEntry, Phase } from '@/lib/types';
import { useMissionStore } from '@/store/missionStore';

const PHASE_TONE: Record<Phase, BadgeTone> = {
  SEARCH: 'blue',
  EXTRACT: 'green',
  COMPLETE: 'green',
};
export default function AgentPanel({ className = '' }: { className?: string }) {
  const status = useMissionStore((s) => s.status);
  const error = useMissionStore((s) => s.error);
  const phase = useMissionStore((s) => s.rover.phase);
  const step = useMissionStore((s) => s.rover.step);
  const decision = useMissionStore((s) => s.lastDecision);
  const memory = useMissionStore((s) => s.memory);
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
        {status === 'idle' && !decision && <p className="text-zinc-500">Press Run. Gemini (or the mock decider) will choose where to move.</p>}
        {decision && (
          <>
            <Row label="Movement">
              <span className="font-mono text-emerald-300">
                {decision.mark_survivor ? 'MARK_SURVIVOR · ' : ''}
                bearing {Math.round(decision.bearing_deg)}° · {decision.distance_m} m
              </span>
            </Row>
            <Row label="Reason">
              <span className="italic text-zinc-200">“{decision.reason}”</span>
            </Row>
            <Row label="Memory">
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-black/20 p-2 font-mono text-[10px] text-zinc-300">
                {memory || '(empty)'}
              </pre>
            </Row>
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
