'use client';
/** P4 — metrics strip: step, decisions used/remaining, distance, last latency, tokens. */
import { useMissionStore } from '@/store/missionStore';

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col px-3 py-1.5">
      <span className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="font-mono text-sm text-zinc-100">
        {value}
        {sub && <span className="ml-1 text-[10px] text-zinc-500">{sub}</span>}
      </span>
    </div>
  );
}

export default function MetricsStrip({ className = '' }: { className?: string }) {
  const step = useMissionStore((s) => s.rover.step);
  const used = useMissionStore((s) => s.rover.decisionsUsed);
  const budget = useMissionStore((s) => s.budget);
  const dist = useMissionStore((s) => s.distanceTraveledM);
  const latency = useMissionStore((s) => s.lastLatencyMs);
  const model = useMissionStore((s) => s.lastModel);
  const lastTokens = useMissionStore((s) => s.lastTokens);
  const totalTokens = useMissionStore((s) => s.totalTokens);
  const memoryLength = useMissionStore((s) => s.memory.length);
  const status = useMissionStore((s) => s.status);

  return (
    <div className={`flex divide-x divide-zinc-800 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/80 ${className}`}>
      <Metric label="Status" value={status.replace(/_/g, ' ')} />
      <Metric label="Step" value={String(step)} />
      <Metric label="Decisions" value={`${used} / ${budget}`} sub={`${Math.max(0, budget - used)} left`} />
      <Metric label="Distance" value={`${dist.toFixed(1)} m`} />
      <Metric label="Latency" value={latency === null ? '—' : `${latency} ms`} />
      <Metric label="Model" value={model ?? '—'} />
      <Metric label="Tokens" value={lastTokens ? String(lastTokens.total) : '—'} sub={`Σ ${totalTokens}`} />
      <Metric label="Memory" value={`${memoryLength}`} sub="chars" />
    </div>
  );
}
