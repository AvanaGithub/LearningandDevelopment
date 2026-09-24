import React, { useState } from 'react';
import { readSheet } from '../xlsx.js';

// Excel import with column mapping, matching the prototype flow: pick a file,
// match each system field to a column (auto-matched by similar names), preview
// the first rows, import. `onImport(objs)` returns a summary string.
export default function ImportDialog({ title, fields, onImport, onClose }) {
  const [sheet, setSheet] = useState(null);   // {headers, rows}
  const [map, setMap] = useState({});
  const [fname, setFname] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const autoMatch = (field, headers) => {
    const H = headers.map((h) => h.toLowerCase().trim());
    for (const s of field.syn) { const i = H.indexOf(s); if (i >= 0) return i; }
    for (const s of field.syn) { const i = H.findIndex((h) => h.includes(s)); if (i >= 0) return i; }
    return -1;
  };

  const pick = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setErr(null);
    setFname(f.name);
    try {
      const aoa = await readSheet(f);
      const headers = (aoa[0] || []).map((h) => String(h).trim());
      const rows = aoa.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
      if (!headers.length || !rows.length) throw new Error('The first sheet needs a header row plus at least one data row.');
      const m = {};
      fields.forEach((fl) => { m[fl.key] = autoMatch(fl, headers); });
      setSheet({ headers, rows });
      setMap(m);
    } catch (e2) { setErr(e2.message); }
  };

  const objs = () => sheet.rows
    .map((r) => {
      const o = {};
      fields.forEach((fl) => { if (map[fl.key] >= 0) o[fl.key] = String(r[map[fl.key]] ?? '').trim(); });
      return o;
    })
    .filter((o) => fields.every((fl) => !fl.req || o[fl.key]));

  const doImport = async () => {
    setBusy(true);
    setErr(null);
    try {
      const summary = await onImport(objs());
      onClose(summary);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  const missing = sheet ? fields.filter((fl) => fl.req && map[fl.key] < 0) : [];
  const previewCols = sheet ? fields.filter((fl) => map[fl.key] >= 0) : [];

  return (
    <div className="modal-backdrop" onClick={() => onClose(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <h3>{title}</h3>
        {!sheet ? (
          <>
            <p className="muted mini">Pick an Excel (.xlsx) or CSV file. The first sheet's header row becomes the columns you map.</p>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={pick} style={{ marginTop: 8 }} />
          </>
        ) : (
          <>
            <p className="muted mini">{fname} · {sheet.rows.length} data row(s). Match each field to a column — * fields are required; "— skip —" ignores a field.</p>
            <div className="form-grid" style={{ marginTop: 10 }}>
              {fields.map((fl) => (
                <div key={fl.key}><label>{fl.label}{fl.req ? ' *' : ''}</label>
                  <select value={map[fl.key]} onChange={(e) => setMap({ ...map, [fl.key]: Number(e.target.value) })}>
                    <option value={-1}>— skip —</option>
                    {sheet.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select></div>
              ))}
            </div>
            <h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Preview — first 3 rows as they will import</h3>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr>{previewCols.map((fl) => <th key={fl.key}>{fl.label}</th>)}</tr></thead>
                <tbody>
                  {sheet.rows.slice(0, 3).map((r, i) => (
                    <tr key={i}>{previewCols.map((fl) => <td key={fl.key}>{r[map[fl.key]]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missing.length > 0 && <p className="err">Map the required column(s): {missing.map((f) => f.label).join(', ')}</p>}
          </>
        )}
        {err && <p className="err">{err}</p>}
        <div className="form-actions">
          {sheet && <button className="btn gold" disabled={busy || missing.length > 0} onClick={doImport}>
            {busy ? 'Importing…' : `Import ${objs().length} record(s)`}</button>}
          <button className="btn" disabled={busy} onClick={() => onClose(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
