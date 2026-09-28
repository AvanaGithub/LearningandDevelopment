import React, { useEffect, useRef, useState } from 'react';

// Multi-choice dropdown. Closes when clicking anywhere outside it, and
// opening one closes any sibling dropdowns (native <details> does neither).
// Long lists (>12 options) get a type-to-filter box automatically.
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

  const n = sel.length;
  const one = n === 1 && options.find((o) => o.v === sel[0]);
  const summary = n === 0 ? `${label}: ${empty}` : n === 1 ? (one ? one.t : '1 selected') : `${label}: ${n} selected`;
  const t = q.trim().toLowerCase();
  const shown = t ? options.filter((o) => o.t.toLowerCase().includes(t)) : options;

  return (
    <details className="msel" ref={ref} onToggle={onToggle}>
      <summary>{summary.length > 34 ? summary.slice(0, 32) + '…' : summary} ▾</summary>
      <div className="menu">
        {options.length > 12 && (
          <input value={q} placeholder="Type to filter…" onChange={(e) => setQ(e.target.value)}
            style={{ width: '100%', marginBottom: 6, fontSize: 12 }} />
        )}
        <label><input type="checkbox" checked={!n} onChange={() => onChange([])} /> {empty}</label>
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
            <input type="checkbox" checked={sel.includes(o.v)}
              onChange={(e) => onChange(e.target.checked ? [...sel, o.v] : sel.filter((x) => x !== o.v))} />
            {o.t}
          </label>
        ))}
        {!shown.length && <div className="muted mini" style={{ padding: '4px 2px' }}>No match.</div>}
      </div>
    </details>
  );
}
