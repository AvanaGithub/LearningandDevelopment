import React, { useState } from 'react';
import { api } from '../api.js';
import { readSheet } from '../xlsx.js';

// Excel import of assessment scores (a Microsoft Forms quiz export works
// as-is: Email / Name / Total points). Rows are matched to the eligible
// people by e-mail, Zoho ID or name; marks go in raw and convert to /100.
export default function ScoreImport({ title, people, maxMarks, postTo, onClose, onDone }) {
  const [sheet, setSheet] = useState(null);   // {headers, rows}
  const [idCol, setIdCol] = useState(0);
  const [ptsCol, setPtsCol] = useState(0);
  const [timeCol, setTimeCol] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const pick = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const aoa = await readSheet(f);
      const headers = (aoa[0] || []).map((h) => String(h).trim());
      const rows = aoa.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
      if (!headers.length) throw new Error('The first sheet needs a header row.');
      const low = headers.map((h) => h.toLowerCase());
      const gId = low.findIndex((h) => /e-?mail|^name$|emp|zoho|participant|respondent/.test(h));
      const gPts = low.findIndex((h) => /total points|^points$|^score$|total score|^marks?\b/.test(h));
      const gTime = low.findIndex((h) => /completion time|submit/.test(h));
      setIdCol(gId >= 0 ? gId : 0);
      setPtsCol(gPts >= 0 ? gPts : Math.max(headers.length - 1, 0));
      setTimeCol(gTime >= 0 ? gTime : '');
      setSheet({ headers, rows });
      setErr(null);
    } catch (e2) { setErr(e2.message); }
  };

  const matchRow = (r) => {
    const key = String(r[idCol] || '').trim().toLowerCase();
    if (!key) return null;
    return people.find((x) =>
      (x.email || '').toLowerCase() === key ||
      (x.zoho_emp_id || '').toLowerCase() === key ||
      x.name.trim().toLowerCase() === key) || null;
  };

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const out = {}; let unmatched = 0; let noScore = 0;
      for (const r of sheet.rows) {
        const p = matchRow(r);
        if (!p) { unmatched++; continue; }
        const v = Number(String(r[ptsCol] ?? '').trim());
        if (!Number.isFinite(v) || String(r[ptsCol] ?? '').trim() === '') { noScore++; continue; }
        const tRaw = timeCol === '' ? null : r[timeCol];
        const t = tRaw ? new Date(tRaw) : null;
        out[p.id] = { employee_id: p.id, score: v,
          submitted_at: t && !isNaN(t) ? t.toISOString() : null }; // last row wins
      }
      const rows = Object.values(out);
      if (!rows.length) throw new Error('No row matched the eligible list — check the respondent and marks columns.');
      const res = await api.post(postTo, { rows });
      onDone(`${res.ok} score(s) imported (out of ${maxMarks})` +
        (unmatched ? ` · ${unmatched} row(s) skipped (not in the list)` : '') +
        (noScore ? ` · ${noScore} row(s) had no marks` : '') + '.');
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  const colOpts = (allowNone) => (
    <>
      {allowNone && <option value="">— none —</option>}
      {sheet.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </>
  );

  const matched = sheet ? sheet.rows.filter((r) => matchRow(r)).length : 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h3>Import scores — {title}</h3>
        {!sheet ? (
          <>
            <p className="muted mini">One row per person with their marks (a Microsoft Forms <b>quiz</b> Excel export
              works as-is — it has Email, Name and Total points columns). Rows are matched by e-mail,
              Zoho ID or name; marks are taken as raw marks out of <b>{maxMarks}</b>.</p>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={pick} style={{ marginTop: 8 }} />
          </>
        ) : (
          <>
            <div className="form-grid">
              <div><label>Respondent column (E-mail / Zoho ID / Name)</label>
                <select value={idCol} onChange={(e) => setIdCol(Number(e.target.value))}>{colOpts(false)}</select></div>
              <div><label>Marks column (out of {maxMarks})</label>
                <select value={ptsCol} onChange={(e) => setPtsCol(Number(e.target.value))}>{colOpts(false)}</select></div>
              <div><label>Submitted-at column (optional)</label>
                <select value={timeCol} onChange={(e) => setTimeCol(e.target.value === '' ? '' : Number(e.target.value))}>{colOpts(true)}</select></div>
            </div>
            <p className="muted mini" style={{ marginTop: 8 }}>
              <b>{matched}</b> of {sheet.rows.length} row(s) match the eligible list — only those are imported.
            </p>
          </>
        )}
        {err && <p className="err">{err}</p>}
        <div className="form-actions">
          {sheet && <button className="btn gold" disabled={busy} onClick={run}>{busy ? 'Importing…' : 'Import scores'}</button>}
          <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
