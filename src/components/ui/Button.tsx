'use client';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/60',
  secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700',
  ghost: 'bg-transparent hover:bg-zinc-800 text-zinc-300 border-transparent',
  danger: 'bg-rose-700 hover:bg-rose-600 text-white border-rose-600/60',
};
const sizes: Record<Size, string> = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm' };

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
    />
  );
}
