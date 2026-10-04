'use client';
/**
 * P4 — Run / Pause / Resume / Regenerate / Reset, decider mode, reveal-truth toggle (after
 * completion), mock/live indicator, save replay.
 */
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { useMission } from '@/hooks/useMission';
import { useMissionStore, useUIStore, type DeciderMode } from '@/store/missionStore';

export default function Controls({ className = '' }: { className?: string }) {
  const { status, deciderMode, run, pause, resume, reset, regenerate, setDeciderMode, downloadReplay } = useMission();
  const lastSource = useMissionStore((s) => s.lastSource);
  const seed = useMissionStore((s) => s.seed);
  const replaySource = useMissionStore((s) => s.replaySource);
  const replayCount = useMissionStore((s) => s.replayLog?.entries.length ?? 0);
  const revealTruth = useUIStore((s) => s.revealTruth);
  const setRevealTruth = useUIStore((s) => s.setRevealTruth);
  const devConsole = useUIStore((s) => s.devConsole);
  const setDevConsole = useUIStore((s) => s.setDevConsole);
  const [serverDecider, setServerDecider] = useState<'mock' | 'gemini' | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((j: { decider?: 'mock' | 'gemini' }) => setServerDecider(j.decider ?? null))
      .catch(() => setServerDecider(null));
  }, []);

  const finished = status === 'complete' || status === 'failed';
  const running = status === 'running' || status === 'waiting_for_gemini';

  const live = lastSource ?? (deciderMode === 'api' ? serverDecider : deciderMode);
  const liveTone = live === 'gemini' ? 'green' : live === 'mock' ? 'amber' : live === 'replay' ? 'blue' : live === 'manual' ? 'violet' : 'neutral';

  return (
    <Card className={className}>
      <CardHeader
        title="Controls"
        right={
          <div className="flex items-center gap-1.5">
            <Badge tone={liveTone}>{live ? (live === 'gemini' ? 'LIVE · gemini' : live) : '…'}</Badge>
            <span className="font-mono text-[10px] text-zinc-500">seed {seed}</span>
          </div>
        }
      />
      <CardBody className="space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          {status === 'paused' ? (
            <Button variant="primary" onClick={resume}>
              ▶ Resume
            </Button>
          ) : (
            <Button variant="primary" onClick={run} disabled={running}>
              ▶ Run
            </Button>
          )}
          <Button onClick={pause} disabled={!running}>
            ❚❚ Pause
          </Button>
          <Button onClick={reset}>Reset</Button>
          <Button onClick={() => regenerate(Math.floor(Math.random() * 100000))} title="New random seed, same terrain params">
            ↻ Regenerate
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            decider
            <select
              value={deciderMode}
              onChange={(e) => setDeciderMode(e.target.value as DeciderMode)}
              disabled={running}
              className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 font-mono text-xs text-zinc-200"
            >
              <option value="api">api (Gemini / mock)</option>
              {process.env.NODE_ENV !== 'production' && <option value="manual">manual console</option>}
              <option value="replay" disabled={!replaySource}>
                replay{replaySource ? ` (${replaySource.entries.length})` : ' — load ?replay=<file>'}
              </option>
            </select>
          </label>
          <Toggle checked={revealTruth} onChange={setRevealTruth} disabled={!finished} label="Reveal truth" />
          {process.env.NODE_ENV !== 'production' && <Toggle checked={devConsole} onChange={setDevConsole} label="Dev console" />}
          <Button size="sm" variant="ghost" onClick={downloadReplay} disabled={replayCount === 0} title="Download this run as a replay log">
            Save replay ({replayCount})
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
