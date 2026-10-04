'use client';
/**
 * Bottom-of-screen radio bar. Briefings are parsed into weighted search constraints
 * and applied by the mission loop; this panel only collects them and shows the weight.
 */
import { useState, type FormEvent } from 'react';
import { useMission } from '@/hooks/useMission';
import { compassLabel, formatFocusOffset, previewCommand } from '@/lib/sim/briefing';
import { useMissionStore } from '@/store/missionStore';

export default function BriefingBar({ immersive }: { immersive: boolean }) {
  const { submitBriefing } = useMission();
  const briefings = useMissionStore((s) => s.briefings);
  const belief = useMissionStore((s) => s.belief);
  const heading = useMissionStore((s) => Math.round(s.rover.headingDeg));
  const rover = useMissionStore((s) => s.rover);
  const command = useMissionStore((s) => s.lastDecision?.bearing_deg);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const preview = belief ? previewCommand(heading, { x: rover.x, z: rover.z }, belief) : null;
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
      data-rover-heading={heading}
      data-rover-x={rover.x.toFixed(1)}
      data-rover-z={rover.z.toFixed(1)}
      data-command-bearing={command == null ? '' : String(Math.round(command))}
      data-belief-strength={belief ? belief.strength.toFixed(2) : ''}
      data-belief-bearing={preview ? String(Math.round(preview.bearingDeg)) : ''}
      data-focus-bearing={belief ? String(Math.round(belief.focusBearingDeg)) : ''}
      data-focus-x={belief ? belief.focus.x.toFixed(1) : ''}
      data-focus-z={belief ? belief.focus.z.toFixed(1) : ''}
      data-highlight-count={belief ? belief.cells.length : 0}
      data-spread={belief ? belief.spreadM.toFixed(1) : ''}
    >
      <form className="flex items-center gap-2 px-2 pt-2" onSubmit={send}>
        <label htmlFor="sarah-briefing" className="sr-only">Tell Sarah new search information</label>
        <input
          id="sarah-briefing"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Tell Sarah — “the hiker is to the south of Sarah’s current location”'
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
      {recent.length > 0 && (
        <ul className="flex gap-1.5 overflow-x-auto px-2 py-1.5" aria-label="Recent briefings">
          {recent.map((b) => {
            const stated = Math.round(b.certainty * 100);
            const applied = Math.round(b.weight * 100);
            return (
              <li
                key={b.id}
                title={`${b.summary}. Language certainty ${stated}%. Applied weight ${applied}%.`}
                data-certainty={b.certainty.toFixed(2)}
                data-certainty-label={b.certaintyLabel}
                data-applied-weight={b.weight.toFixed(2)}
                data-suppressed={b.suppressed ? 'true' : 'false'}
                className={`flex max-w-[34rem] shrink-0 items-center gap-2 rounded border px-2 py-1 text-[11px] ${chip}`}
              >
                <span className="max-w-[22rem] truncate">{b.text}</span>
                <span className={`shrink-0 font-mono uppercase ${b.certaintyLabel === 'high' ? (immersive ? 'text-amber-200' : 'text-amber-800') : b.certaintyLabel === 'low' ? (immersive ? 'text-slate-400' : 'text-slate-500') : ''}`}>
                  {b.certaintyLabel} {stated}%
                </span>
                <span className={`h-1.5 w-12 overflow-hidden rounded ${immersive ? 'bg-white/15' : 'bg-slate-200'}`} aria-hidden>
                  <span className="block h-full bg-amber-500" style={{ width: `${Math.max(4, applied)}%` }} />
                </span>
                {b.suppressed && <span className="shrink-0 text-rose-500">direction overruled · {applied}%</span>}
              </li>
            );
          })}
        </ul>
      )}
      {belief && preview && (
        <p className={`px-2 pb-2 text-[11px] ${immersive ? 'text-amber-100/90' : 'text-slate-700'}`}>
          Search focus {formatFocusOffset({ x: rover.x, z: rover.z }, belief.focus)} ({compassLabel(belief.focusBearingDeg)}) · clue weight {Math.round(belief.strength * 100)}% · next heading {Math.round(preview.bearingDeg)}°
        </p>
      )}
    </footer>
  );
}
