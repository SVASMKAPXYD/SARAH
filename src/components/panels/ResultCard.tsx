'use client';
/** P4 — grading output at mission end (plan §2 "Grading"). */
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useMissionStore } from '@/store/missionStore';

export default function ResultCard({ className = '' }: { className?: string }) {
  const grade = useMissionStore((s) => s.grade);
  const status = useMissionStore((s) => s.status);
  if (!grade) return null;
  const tone = grade.success ? 'green' : status === 'failed' ? 'red' : 'amber';
  return (
    <Card className={`border ${grade.success ? 'border-emerald-700/60' : 'border-rose-800/60'} ${className}`}>
      <CardHeader title="Result" right={<Badge tone={tone}>{grade.outcome.replace(/_/g, ' ')}</Badge>} />
      <CardBody className="space-y-2 text-xs">
        <p className="text-zinc-200">{grade.summary}</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-300">
          <dt className="text-zinc-500">distance error</dt>
          <dd>{grade.distanceErrorM === null ? '—' : `${grade.distanceErrorM.toFixed(1)} m`}</dd>
          <dt className="text-zinc-500">decisions used</dt>
          <dd>{grade.decisionsUsed}</dd>
          <dt className="text-zinc-500">distance traveled</dt>
          <dd>{grade.distanceTraveledM.toFixed(1)} m</dd>
          <dt className="text-zinc-500">returned to base</dt>
          <dd>{grade.returnedToBase ? 'yes' : 'no'}</dd>
        </dl>
        <p className="text-[10px] text-zinc-500">Toggle “Reveal truth” in Controls to compare the rover path with the real world.</p>
      </CardBody>
    </Card>
  );
}
