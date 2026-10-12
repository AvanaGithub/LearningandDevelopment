import React, { useEffect, useRef, useState } from 'react';

// Sentinel for filter dropdowns: "nothing ticked". Filters treat an empty
// selection as "All", so a real None needs its own value — it matches no
// record, which is exactly what an empty tick-list should mean.
export const MSEL_NONE = '__none__';

// Multi-choice dropdown. Closes when clicking anywhere outside it, and
// opening one closes any sibling dropdowns (native <details> does neither).
// Long lists (>12 options) get a type-to-filter box automatically.
// Filter mode (empty = "All"): empty selection shows every box ticked;
// unticking the All box (or the last option) goes to None, not back to All.
export default function MSel({ label, options, sel, onChange, empty = 'All', allowAll = false }) {
  const ref = useRef(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    const onOutside = (e) => {
      const d = ref.current;
      if (d && d.open && !d.contains(e.target)) d.open = false;
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, []);

  const onToggle = () => {
    const d = ref.current;
    if (d && d.open) {
      document.querySelectorAll('details.msel[open]').forEach((x) => { if (x !== d) x.open = false; });
    }
  };

  const filterMode = empty === 'All';
  const isNone = filterMode && sel.length === 1 && sel[0] === MSEL_NONE;
  const real = sel.filter((v) => v !== MSEL_NONE);
  const n = real.length;
  const allTicked = filterMode && sel.length === 0;

  const one = n === 1 && options.find((o) => o.v === real[0]);
  const summary = isNone ? `${label}: None`
    : sel.length === 0 ? `${label}: ${empty}`
      : n === 1 ? (one ? one.t : '1 selected') : `${label}: ${n} selected`;
  const t = q.trim().toLowerCase();
  const shown = t ? options.filter((o) => o.t.toLowerCase().includes(t)) : options;

  const setSel = (vals) => {
    if (!filterMode) return onChange(vals);
    if (vals.length === 0) return onChange([MSEL_NONE]);          // nothing ticked = None
    if (vals.length >= options.length) return onChange([]);       // everything ticked = All
    onChange(vals);
  };

  return (
    <details className="msel" ref={ref} onToggle={onToggle}>
      <summary>{summary.length > 34 ? summary.slice(0, 32) + '…' : summary} ▾</summary>
      <div className="menu">
        {options.length > 12 && (
          <input value={q} placeholder="Type to filter…" onChange={(e) => setQ(e.target.value)}
            style={{ width: '100%', marginBottom: 6, fontSize: 12 }} />
        )}
        <label>
          <input type="checkbox" checked={filterMode ? allTicked : n === 0}
            onChange={() => {
              if (!filterMode) return onChange([]);
              // Toggle between All (everything ticked) and None.
              onChange(allTicked ? [MSEL_NONE] : []);
            }} /> {empty}
        </label>
        {allowAll && shown.length > 0 && (
          <label style={{ fontWeight: 600 }}>
            <input type="checkbox" checked={shown.every((o) => sel.includes(o.v))}
              onChange={(e) => onChange(e.target.checked
                ? [...new Set([...sel, ...shown.map((o) => o.v)])]
                : sel.filter((v) => !shown.some((o) => o.v === v)))} />
            Select all{t ? ' shown' : ''} ({shown.length})
          </label>
        )}
        <hr style={{ border: 0, borderTop: '1px solid var(--line)' }} />
        {shown.map((o) => (
          <label key={o.v}>
            <input type="checkbox" checked={allTicked || real.includes(o.v)}
              onChange={(e) => {
                if (allTicked) return setSel(options.filter((x) => x.v !== o.v).map((x) => x.v));
                const next = e.target.checked ? [...real, o.v] : real.filter((x) => x !== o.v);
                setSel(next);
              }} />
            {o.t}
          </label>
        ))}
        {!shown.length && <div className="muted mini" style={{ padding: '4px 2px' }}>No match.</div>}
      </div>
    </details>
  );
}
