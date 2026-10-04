'use client';

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function Tabs<T extends string>({ items, value, onChange, className = '' }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={`inline-flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 ${className}`}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            t.id === value ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
