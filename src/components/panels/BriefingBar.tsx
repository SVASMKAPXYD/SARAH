'use client';
/**
 * Bottom-of-screen radio bar. Briefings are forwarded verbatim to Gemini as context.
 */
import { useState, type FormEvent } from 'react';
import { useMission } from '@/hooks/useMission';
import { useMissionStore } from '@/store/missionStore';

export default function BriefingBar({ immersive }: { immersive: boolean }) {
  const { submitBriefing } = useMission();
  const briefings = useMissionStore((s) => s.briefings);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recent = briefings.slice(-6).reverse();

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const result = submitBriefing(text);
    if (!result.ok) {
      setError(result.error ?? 'Could not send that briefing.');
      return;
    }
    setText('');
    setError(null);
  };

  const shell = immersive
    ? 'border-t border-white/15 bg-slate-950/92 text-slate-100'
    : 'border-t border-[#8ea3b8] bg-[#e7f0f8] text-slate-900';
  const field = immersive
    ? 'border-white/25 bg-slate-900 text-white placeholder:text-slate-400'
    : 'border-slate-400 bg-white text-slate-900 placeholder:text-slate-500';
  const button = immersive
    ? 'border-amber-200/70 bg-amber-100 text-slate-950 hover:bg-amber-50'
    : 'border-slate-700 bg-slate-900 text-white hover:bg-slate-800';
  const chip = immersive ? 'border-white/20 bg-white/10' : 'border-slate-300 bg-white/90';

  return (
    <footer
      className={`relative z-30 shrink-0 ${shell}`}
      data-briefing-bar
      data-briefing-count={briefings.length}
    >
      <form className="flex items-center gap-2 px-2 pt-2" onSubmit={send}>
        <label htmlFor="sarah-briefing" className="sr-only">Send field information to Gemini</label>
        <input
          id="sarah-briefing"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Field report for Gemini — “the hiker was seen near the creek”"
          autoComplete="off"
          className={`h-8 min-w-0 flex-1 rounded border px-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-700 ${field}`}
        />
        <button
          type="submit"
          className={`h-8 shrink-0 rounded border px-3 text-sm font-medium shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-700 ${button}`}
        >
          Send
        </button>
      </form>
      {error && <p className="px-2 pt-1 text-xs text-rose-600">{error}</p>}
      <p className={`px-2 pt-1 text-[11px] ${immersive ? 'text-slate-300' : 'text-slate-600'}`}>
        Field reports are sent verbatim to Gemini. Gemini alone decides how to use them.
      </p>
      {recent.length > 0 && (
        <ul className="flex gap-1.5 overflow-x-auto px-2 py-1.5" aria-label="Recent field reports sent to Gemini">
          {recent.map((briefing, index) => {
            return (
              <li
                key={`${briefings.length - index}:${briefing}`}
                title={briefing}
                className={`max-w-[34rem] shrink-0 truncate rounded border px-2 py-1 text-[11px] ${chip}`}
              >
                <span className="max-w-[32rem]">{briefing}</span>
              </li>
            );
          })}
        </ul>
      )}
    </footer>
  );
}
