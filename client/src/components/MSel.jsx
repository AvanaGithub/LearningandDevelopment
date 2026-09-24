import React, { useEffect, useRef } from 'react';

// Multi-choice dropdown. Closes when clicking anywhere outside it, and
// opening one closes any sibling dropdowns (native <details> does neither).
export default function MSel({ label, options, sel, onChange }) {
  const ref = useRef(null);

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
  const summary = n === 0 ? `${label}: All` : n === 1 ? (one ? one.t : '1 selected') : `${label}: ${n} selected`;

  return (
    <details className="msel" ref={ref} onToggle={onToggle}>
      <summary>{summary.length > 34 ? summary.slice(0, 32) + '…' : summary} ▾</summary>
      <div className="menu">
        <label><input type="checkbox" checked={!n} onChange={() => onChange([])} /> All</label>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)' }} />
        {options.map((o) => (
          <label key={o.v}>
            <input type="checkbox" checked={sel.includes(o.v)}
              onChange={(e) => onChange(e.target.checked ? [...sel, o.v] : sel.filter((x) => x !== o.v))} />
            {o.t}
          </label>
        ))}
      </div>
    </details>
  );
}
