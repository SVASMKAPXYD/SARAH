'use client';
/**
 * P4 — terrain chat (plan §2): a sentence → POST /api/terrain → TerrainParams → regenerate.
 * Advanced tab: sliders for every TerrainParams field + seed input.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { useMission } from '@/hooks/useMission';
import { describeLight } from '@/lib/gemini/schema';
import type { TerrainParams } from '@/lib/types';
import { useMissionStore } from '@/store/missionStore';

type Tab = 'chat' | 'advanced';

const SLIDERS: { key: keyof TerrainParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'light_level', label: 'light level', min: 0, max: 1, step: 0.05 },
  { key: 'tree_density', label: 'tree density', min: 0, max: 1, step: 0.05 },
  { key: 'fallen_logs', label: 'fallen logs', min: 0, max: 1, step: 0.05 },
  { key: 'fog_density', label: 'fog', min: 0, max: 1, step: 0.05 },
  { key: 'moonlight', label: 'moonlight', min: 0, max: 1, step: 0.05 },
  { key: 'branchiness', label: 'branchiness', min: 0, max: 1, step: 0.05 },
  { key: 'car_count', label: 'cars', min: 0, max: 4, step: 1 },
  { key: 'fox_count', label: 'foxes', min: 0, max: 4, step: 1 },
  { key: 'deer_count', label: 'deer', min: 0, max: 4, step: 1 },
  { key: 'fungi_patches', label: 'fungi patches', min: 0, max: 3, step: 1 },
];

export default function TerrainChat({ className = '' }: { className?: string }) {
  const { regenerate, status } = useMission();
  const params = useMissionStore((s) => s.params);
  const seed = useMissionStore((s) => s.seed);
  const [tab, setTab] = useState<Tab>('chat');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [narration, setNarration] = useState<string>(params.narration);
  const [source, setSource] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<TerrainParams>(params);
  const [seedDraft, setSeedDraft] = useState<string>(String(seed));
  const running = status === 'running' || status === 'waiting_for_gemini';

  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/terrain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, current: params }),
      });
      const json = (await res.json()) as { params?: TerrainParams; source?: string; error?: string };
      if (!res.ok || !json.params) throw new Error(json.error ?? `HTTP ${res.status}`);
      const next = json.params;
      setNarration(next.narration);
      setSource(json.source ?? null);
      setDraft(next);
      const newSeed = next.seed ?? seed;
      setSeedDraft(String(newSeed));
      regenerate(newSeed, next);
      setPrompt('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyAdvanced = () => {
    const s = Number(seedDraft);
    regenerate(Number.isFinite(s) ? s : seed, { ...draft, seed: Number.isFinite(s) ? s : undefined });
  };

  return (
    <Card className={className}>
      <CardHeader title="Terrain" right={<Tabs<Tab> items={[{ id: 'chat', label: 'Chat' }, { id: 'advanced', label: 'Advanced' }]} value={tab} onChange={setTab} />} />
      <CardBody className="space-y-2 text-xs">
        {tab === 'chat' ? (
          <>
            <p className="text-zinc-200">
              {narration}
              {source && <span className="ml-1 text-zinc-500">({source})</span>}
            </p>
            <p className="font-mono text-[10px] leading-relaxed text-zinc-400">
              Light {params.light_level.toFixed(2)} ({describeLight(params.light_level)}) · slope 0 · bump 0 · cars {params.car_count} · animals {params.fox_count} fox / {params.deer_count} deer · survivor {params.survivor_situation}
              {params.fog_density >= 0.65 ? ' · thick fog' : ''}
            </p>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="evening, clearer sky, survivor in a ditch, add cars and animals…"
                disabled={busy || running}
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
              />
              <Button type="submit" size="md" variant="primary" disabled={busy || running || !prompt.trim()}>
                {busy ? '…' : 'Generate'}
              </Button>
            </form>
            {err && <p className="text-rose-300">{err}</p>}
            {running && <p className="text-[10px] text-zinc-500">Pause or reset the mission before regenerating the world.</p>}
          </>
        ) : (
          <>
            <p className="text-[11px] text-zinc-500">Slope and bumpiness are fixed at 0 for now.</p>
            <div className="grid grid-cols-1 gap-1.5">
              {SLIDERS.map((s) => (
                <label key={s.key} className="grid grid-cols-[92px_1fr_36px] items-center gap-2 text-zinc-400">
                  <span>{s.label}</span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={Number(draft[s.key])}
                    onChange={(e) => setDraft({ ...draft, [s.key]: Number(e.target.value) })}
                    className="accent-emerald-500"
                  />
                  <span className="text-right font-mono text-zinc-200">{Number(draft[s.key]).toFixed(s.step < 1 ? 2 : 0)}</span>
                </label>
              ))}
              <label className="grid grid-cols-[92px_1fr] items-center gap-2 text-zinc-400">
                <span>survivor</span>
                <select
                  value={draft.survivor_situation}
                  onChange={(e) => setDraft({ ...draft, survivor_situation: e.target.value as TerrainParams['survivor_situation'] })}
                  className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 font-mono text-xs text-zinc-200"
                >
                  <option value="seated">seated</option>
                  <option value="ditch">ditch</option>
                  <option value="slope">slope</option>
                  <option value="obstacle">obstacle</option>
                </select>
              </label>
              <label className="grid grid-cols-[92px_1fr] items-center gap-2 text-zinc-400">
                <span>water</span>
                <select
                  value={draft.water}
                  onChange={(e) => setDraft({ ...draft, water: e.target.value as TerrainParams['water'] })}
                  className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 font-mono text-xs text-zinc-200"
                >
                  <option value="none">none</option>
                  <option value="creek">creek</option>
                  <option value="pond">pond</option>
                </select>
              </label>
              <label className="grid grid-cols-[92px_1fr] items-center gap-2 text-zinc-400">
                <span>seed</span>
                <input
                  value={seedDraft}
                  onChange={(e) => setSeedDraft(e.target.value)}
                  inputMode="numeric"
                  className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 font-mono text-xs text-zinc-200"
                />
              </label>
            </div>
            <div className="flex justify-end gap-1.5">
              <Button size="sm" onClick={() => setDraft(params)}>
                Revert
              </Button>
              <Button size="sm" variant="primary" onClick={applyAdvanced} disabled={running}>
                Regenerate
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
