import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-lg border border-zinc-800 bg-zinc-900/80 ${className}`} />;
}

export function CardHeader({ title, right, className = '' }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between border-b border-zinc-800 px-3 py-2 ${className}`}>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
      {right}
    </div>
  );
}

export function CardBody({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`p-3 ${className}`} />;
}
