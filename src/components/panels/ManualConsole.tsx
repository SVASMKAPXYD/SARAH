'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useMission } from '@/hooks/useMission';
import type { Decision } from '@/lib/types';

const example: Decision = {
  bearing_deg: 0,
  distance_m: 8,
  reason: 'Move forward to inspect the path.',
  replace_entire_memory: '',
};

export default function ManualConsole({ className = '' }: { className?: string }) {
  const { submitManualDecision, setDeciderMode, deciderMode, status } = useMission();
  const [text, setText] = useState(() => JSON.stringify(example, null, 2));
  const [msg, setMsg] = useState<string | null>(null);

  const waiting = deciderMode === 'manual' && status === 'waiting_for_gemini';
  const submit = () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      const result = submitManualDecision(parsed);
      setMsg(result.ok ? 'submitted' : result.error ?? 'rejected');
    } catch (error) {
      setMsg(`invalid JSON: ${(error as Error).message}`);
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
          <Button size="sm" variant="ghost" onClick={() => setText(JSON.stringify(example, null, 2))}>MOVE 8 m</Button>
          <Button size="sm" variant="ghost" onClick={() => setText(JSON.stringify({ ...example, bearing_deg: 90, distance_m: 0, reason: 'Look east.' }, null, 2))}>Turn east</Button>
          <Button size="sm" variant="ghost" onClick={() => setText(JSON.stringify({ ...example, mark_survivor: true, reason: 'The hiker is here.' }, null, 2))}>MARK survivor</Button>
          <Button size="sm" variant="ghost" onClick={() => setText(JSON.stringify({ ...example, replace_entire_memory: '# Persistent memory\n- Creek is north of base.\n- Continue searching, mark the survivor, then return to base.' }, null, 2))}>Replace full memory</Button>
        </div>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          rows={7}
          className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-[11px] leading-snug text-zinc-200"
        />
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={submit} disabled={!waiting}>Submit decision</Button>
          <span className="font-mono text-[10px] text-zinc-500">RGB + thermal + depth inputs · absolute bearing</span>
          {msg && <span className="ml-auto text-zinc-400">{msg}</span>}
        </div>
      </CardBody>
    </Card>
  );
}
