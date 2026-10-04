import type { HTMLAttributes } from 'react';

export type BadgeTone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  green: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60',
  amber: 'bg-amber-900/60 text-amber-300 border-amber-700/60',
  red: 'bg-rose-900/60 text-rose-300 border-rose-700/60',
  blue: 'bg-sky-900/60 text-sky-300 border-sky-700/60',
  violet: 'bg-violet-900/60 text-violet-300 border-violet-700/60',
};

export function Badge({ tone = 'neutral', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${tones[tone]} ${className}`}
    />
  );
}
