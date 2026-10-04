'use client';
/**
 * Thought transcript: real decision / narration / result lines from the mission feed,
 * newest at the bottom. While a run is active and nothing new has arrived, a short
 * status line is derived from the live sim (phase, distance, last result) on a
 * 5–15s cadence. Paused runs and a quiet mock decider do not get filler text.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { FeedEntry } from '@/lib/types';
import { useMissionStore, type MissionState } from '@/store/missionStore';
import PlaceGraph from '@/components/panels/PlaceGraph';

type ThoughtTab = 'transcript' | 'graph';

type Line = { id: string; t: number; kind: string; text: string };

function feedText(e: FeedEntry): string {
  if (e.kind === 'decision' && e.decision) {
    const d = e.decision;
    const action = d.action.type === 'MOVE'
      ? `MOVE ${d.action.turn_deg ?? 0}° / ${d.action.distance_m ?? 0} m`
      : d.action.type;
    const updates = [
      d.map_update.node_here ? `${d.map_update.node_here.kind} node (${d.map_update.node_here.note})` : '',
      ...d.map_update.new_frontiers.map((f) => `frontier ${f.bearing_deg}° / ${f.estimated_distance_m} m`),
      ...d.map_update.frontier_updates.map((f) => `${f.id} → ${f.status}`),
      d.map_update.edge_annotation ? `edge ${d.map_update.edge_annotation.terrain}, hazard ${d.map_update.edge_annotation.hazard_cost}` : '',
    ].filter(Boolean);
    return [
      `Observations: ${d.observations}`,
      `Assessment: ${d.survivor_assessment}; intent: ${d.intent}`,
      `Evidence: thermal ${d.evidence.thermal}; RGB person ${d.evidence.rgb_person}; bearing ${d.evidence.bearing_deg ?? 'none'}`,
      `Map update: ${updates.length ? updates.join('; ') : 'none'}`,
      `Action: ${action}. Reason: ${d.brief_reason}`,
      e.model ? `Model: ${e.model}` : '',
    ].filter(Boolean).join('\n');
  }
  if (e.kind === 'thought' && e.thought) return e.thought;
  return e.text;
}

function derivedStatus(s: MissionState): string {
  const r = s.rover;
  const result = s.lastResult.trim();
  if (/^(MOVED|BLOCKED|TURNED|MARK_)/i.test(result)) return result;
  if (s.status === 'waiting_for_gemini') return `${r.phase} · waiting at step ${r.step}`;
  return `${r.phase} · step ${r.step} · ${s.distanceTraveledM.toFixed(0)} m traveled`;
}

const TONE: Record<string, string> = {
  decision: 'text-slate-900',
  thought: 'italic text-slate-800',
  result: 'text-slate-700',
  system: 'text-[12px] text-slate-500',
  error: 'text-rose-700',
  status: 'text-slate-600',
};

const TABS: { id: ThoughtTab; label: string }[] = [
  { id: 'transcript', label: 'Thoughts' },
  { id: 'graph', label: 'Place graph' },
];

export default function ThoughtPanel() {
  const feed = useMissionStore((s) => s.feed);
  const status = useMissionStore((s) => s.status);
  const error = useMissionStore((s) => s.error);
  const [tab, setTab] = useState<ThoughtTab>('transcript');
  const [derived, setDerived] = useState<Line[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  const prevFeedLen = useRef(feed.length);
  useEffect(() => {
    // Reset/regenerate replaces the log with a shorter feed. Drop derived lines too,
    // even when both store writes land in one render and length never passes through 0.
    if (feed.length < prevFeedLen.current) setDerived([]);
    prevFeedLen.current = feed.length;
  }, [feed.length]);

  useEffect(() => {
    const active = status === 'running' || status === 'waiting_for_gemini';
    if (!active) return;
    let timer = 0;
    let cancelled = false;
    const arm = () => {
      const at = useMissionStore.getState().feed.length;
      const delay = 5000 + Math.random() * 10000;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const s = useMissionStore.getState();
        const still = s.status === 'running' || s.status === 'waiting_for_gemini';
        if (still && s.feed.length === at) {
          const text = derivedStatus(s);
          setDerived((d) => (d[d.length - 1]?.text === text ? d : [...d.slice(-29), { id: `s-${Date.now()}`, t: Date.now(), kind: 'status', text }]));
        }
        arm();
      }, delay);
    };
    arm();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [status]);

  const lines = useMemo<Line[]>(() => {
    const fromFeed = feed.map((e) => ({ id: `f${e.id}`, t: e.t, kind: e.kind, text: feedText(e) }));
    return [...fromFeed, ...derived].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  }, [feed, derived]);

  useEffect(() => {
    if (tab !== 'transcript') return;
    const el = scroller.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    pin();
    const id = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(id);
  }, [lines, tab]);

  useEffect(() => {
    if (tab !== 'transcript') return;
    const contentEl = content.current;
    if (!contentEl) return;

    const observer = new ResizeObserver(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [tab]);

  const waiting = status === 'waiting_for_gemini';

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.id);
    document.getElementById(`thought-tab-${next.id}`)?.focus();
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-[#8ea3b8] bg-[#d5e6f7]" aria-label="Robot's thought process">
      <h2 className="shrink-0 truncate px-2 pt-1.5 text-center text-xs font-medium text-slate-800">Robot&apos;s thought process</h2>
      <div role="tablist" aria-label="Thought process views" className="flex shrink-0 justify-center gap-1 px-2 pb-1 pt-1" onKeyDown={onTabKey}>
        {TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              id={`thought-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`thought-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium ${selected ? 'bg-slate-800 text-white' : 'bg-white/80 text-slate-700 hover:bg-white'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {error && <p className="shrink-0 px-3 pb-1 text-xs text-rose-700">{error}</p>}
      <div className="relative min-h-0 flex-1">
        <div
          id="thought-panel-transcript"
          role="tabpanel"
          aria-labelledby="thought-tab-transcript"
          hidden={tab !== 'transcript'}
          ref={scroller}
          className="absolute inset-0 overflow-y-auto px-3 pb-2"
        >
          <div ref={content} role="log" aria-label="Thought transcript">
            {lines.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Thoughts will show up here during a run.</p>}
            {lines.map((line) => (
              <p key={line.id} className={`whitespace-pre-line border-t border-slate-400/25 py-1.5 text-[13px] leading-snug first:border-t-0 ${TONE[line.kind] ?? 'text-slate-800'}`}>
                {line.text}
              </p>
            ))}
          </div>
        </div>
        <div id="thought-panel-graph" role="tabpanel" aria-labelledby="thought-tab-graph" hidden={tab !== 'graph'} className="absolute inset-0">
          <PlaceGraph />
        </div>
      </div>
      {waiting && <p className="shrink-0 px-3 pb-2 text-[11px] text-slate-600">Waiting for the next decision…</p>}
    </section>
  );
}
