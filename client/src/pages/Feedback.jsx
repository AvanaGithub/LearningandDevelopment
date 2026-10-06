import React, { useEffect, useState } from 'react';
import { api, fmtRange } from '../api.js';
import { useAuth, useToast } from '../App.jsx';
import { toXlsx, readSheet } from '../xlsx.js';
import QrModal from '../components/QrModal.jsx';

// Excel import of feedback collected offline (e.g. a Microsoft Forms
// export). The sheet's own rating columns BECOME this training's
// questions — each training keeps its own set. Rows are matched to the
// training's participants by Zoho ID, name or e-mail.
function FbImport({ t, participants, onClose, onDone }) {
  const [sheet, setSheet] = useState(null);     // {headers, rows, qSel:Set(colIdx)}
  const [idCol, setIdCol] = useState(0);
  const [cCol, setCCol] = useState('');         // comment column
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const META = /^(id|start ?time|completion ?time|last modified|e-?mail|name|employee|emp ?id|zoho|timestamp|total points|quiz feedback|points|grade)/i;

  const pick = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const aoa = await readSheet(f);
      const headers = (aoa[0] || []).map((h) => String(h).trim());
      const rows = aoa.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
      if (!headers.length || !rows.length) throw new Error('The first sheet needs a header row plus data rows.');
      const low = headers.map((h) => h.toLowerCase());
      const guessId = low.findIndex((h) => /emp|zoho|e-?mail|name|participant|respondent/.test(h));
      const gc = low.findIndex((h) => /comment|improve|suggest|remark/.test(h));
      // A column is a question when most of its filled cells are ratings 1–5.
      const isRating = (i) => {
        const vals = rows.map((r) => String(r[i] ?? '').trim()).filter(Boolean);
        if (!vals.length) return false;
        const ok = vals.filter((v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5).length;
        return ok / vals.length >= 0.5;
      };
      const qSel = new Set(headers.map((h, i) => i)
        .filter((i) => i !== guessId && i !== gc && !META.test(headers[i]) && isRating(i)));
      setIdCol(guessId >= 0 ? guessId : 0);
      setCCol(gc >= 0 ? gc : '');
      setSheet({ headers, rows, qSel });
    } catch (e2) { setErr(e2.message); }
  };

  const toggleQ = (i) => setSheet((s) => {
    const qSel = new Set(s.qSel);
    qSel.has(i) ? qSel.delete(i) : qSel.add(i);
    return { ...s, qSel };
  });

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const qIdx = sheet.headers.map((h, i) => i).filter((i) => sheet.qSel.has(i));
      const questions = qIdx.map((i) => sheet.headers[i] || `Question ${i + 1}`);
      const out = [];
      let unmatched = 0;
      for (const r of sheet.rows) {
        const key = String(r[idCol] || '').trim().toLowerCase();
        const p = participants.find((x) =>
          (x.zoho_emp_id || '').toLowerCase() === key ||
          x.name.toLowerCase() === key ||
          (x.email || '').toLowerCase() === key);
        if (!p) { unmatched++; continue; }
        const scores = {};
        qIdx.forEach((col, i) => {
          const v = Number(String(r[col]).trim());
          if (Number.isInteger(v) && v >= 1 && v <= 5) scores[i] = v;
        });
        out.push({ employee_id: p.id, respondent: p.name, scores,
          comment: cCol === '' ? null : String(r[cCol] || '').trim() || null });
      }
      if (!out.length) throw new Error('No row matched the participant list — check the respondent column.');
      const res = await api.post(`/api/feedback/${t.id}/import`, { questions, rows: out });
      onDone(`${res.ok} response(s) imported with ${questions.length} question(s) from your sheet${res.skipped ? ` · ${res.skipped} skipped (no valid 1–5 ratings)` : ''}${unmatched ? ` · ${unmatched} row(s) skipped (not in the participant list)` : ''}.`);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  const colOpts = (allowNone) => (
    <>
      {allowNone && <option value="">— none —</option>}
      {sheet.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h3>Import feedback — {t.title}</h3>
        {!sheet ? (
          <>
            <p className="muted mini">One row per respondent, one column per question with ratings 1–5 (a Microsoft Forms
              Excel export works as-is). The sheet's question columns become this training's questions —
              every training keeps its own set. Rows are matched to the participants by Zoho ID, name or e-mail.</p>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={pick} style={{ marginTop: 8 }} />
          </>
        ) : (
          <>
            <div className="form-grid">
              <div><label>Respondent column (Zoho ID / Name / E-mail)</label>
                <select value={idCol} onChange={(e) => setIdCol(Number(e.target.value))}>{colOpts(false)}</select></div>
              <div><label>Comment column (optional)</label>
                <select value={cCol} onChange={(e) => setCCol(e.target.value === '' ? '' : Number(e.target.value))}>{colOpts(true)}</select></div>
            </div>
            <p className="muted mini" style={{ margin: '10px 0 4px' }}>
              These sheet columns become this training's questions — untick anything that isn't one:
            </p>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {sheet.headers.map((h, i) => (i === idCol || i === cCol) ? null : (
                <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={sheet.qSel.has(i)} onChange={() => toggleQ(i)} />
                  <span style={{ flex: 1 }}>{h || `Column ${i + 1}`}</span>
                  {!sheet.qSel.has(i) && <span className="muted mini">ignored</span>}
                </label>
              ))}
            </div>
            {(() => {
              const matched = sheet.rows.filter((r) => {
                const key = String(r[idCol] || '').trim().toLowerCase();
                return participants.some((x) =>
                  (x.zoho_emp_id || '').toLowerCase() === key ||
                  x.name.toLowerCase() === key ||
                  (x.email || '').toLowerCase() === key);
              }).length;
              return (
                <p className="muted mini" style={{ marginTop: 8 }}>
                  <b>{sheet.qSel.size}</b> question(s) selected · <b>{matched}</b> of {sheet.rows.length} row(s) match
                  this training's participant list — only those are imported.
                </p>
              );
            })()}
          </>
        )}
        {err && <p className="err">{err}</p>}
        <div className="form-actions">
          {sheet && <button className="btn gold" disabled={busy || !sheet.qSel.size} onClick={run}>
            {busy ? 'Importing…' : 'Import feedback'}</button>}
          <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const STD_QS = [
  'Relevance of content to my job', "Trainer's subject knowledge", "Trainer's delivery and clarity",
  'Quality of material handed out', 'Duration was adequate', 'Confidence to apply this at work',
  'Overall rating', 'Would you recommend this training (NPS)',
];

export default function Feedback() {
  const { user: me } = useAuth();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const [list, setList] = useState(null);
  const [respond, setRespond] = useState(null);   // {t, questions, scores, comment}
  const [results, setResults] = useState(null);   // {t, questions, responses}
  const [builder, setBuilder] = useState(null);   // {t, checked:Set(labels), custom:[], newQ}
  const [importing, setImporting] = useState(null); // {t, questions, participants}
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState(null);

  const exportResults = (r) => toXlsx(
    ('Feedback-' + r.t.code + '.xlsx').replace(/[^\w.-]+/g, '-'),
    ['Respondent', ...r.questions.map((q, i) => `Q${i + 1} ${q}`), 'Comment'],
    r.responses.map((x) => [x.respondent, ...r.questions.map((q, i) => x.scores[i] ?? ''), x.comment || '']),
    'Feedback');

  const load = () => api.get('/api/trainings')
    .then((rows) => setList(rows.filter((t) => t.status !== 'cancelled')))
    .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const openRespond = async (t) => {
    try {
      const d = await api.get('/api/feedback/' + t.id);
      const scores = {};
      if (d.my_response) Object.assign(scores, d.my_response.scores);
      setRespond({ t, questions: d.questions, scores, comment: d.my_response?.comment || '', mine: !!d.my_response });
    } catch (e) { setErr(e.message); }
  };
  const submit = async () => {
    try {
      await api.post('/api/feedback/' + respond.t.id, { scores: respond.scores, comment: respond.comment });
      toast('Feedback submitted — tagged to this training.');
      setRespond(null);
      load();
    } catch (e) { setErr(e.message); }
  };

  const openResults = async (t) => {
    try {
      const d = await api.get('/api/feedback/' + t.id);
      setResults({ t, ...d });
    } catch (e) { setErr(e.message); }
  };

  const openImport = async (t) => {
    try {
      const [d, detail] = await Promise.all([api.get('/api/feedback/' + t.id), api.get('/api/trainings/' + t.id)]);
      if (!detail.participants.length) { setErr('This training has no participants yet — add them first.'); return; }
      setImporting({ t, questions: d.questions, participants: detail.participants });
    } catch (e) { setErr(e.message); }
  };

  const openBuilder = async (t) => {
    try {
      const d = await api.get('/api/feedback/' + t.id);
      const current = d.questions || [];
      setBuilder({
        t,
        checked: new Set(STD_QS.filter((q) => current.includes(q))),
        custom: current.filter((q) => !STD_QS.includes(q)),
        newQ: '',
        ext: d.external_form_url || '',
      });
    } catch (e) { setErr(e.message); }
  };
  const saveForm = async () => {
    try {
      const questions = [...STD_QS.filter((q) => builder.checked.has(q)), ...builder.custom];
      await api.put(`/api/feedback/${builder.t.id}/form`, { questions, external_form_url: builder.ext.trim() || null });
      toast(builder.ext.trim()
        ? 'Saved — the QR/link now sends participants to the Microsoft Form.'
        : `Feedback form saved — ${questions.length} questions.`);
      setBuilder(null); load();
    } catch (e) { setErr(e.message); }
  };

  const avg = (responses, i) => {
    const vals = responses.map((r) => Number(r.scores[i])).filter((v) => v >= 1);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
  };

  return (
    <>
      <div className="page-head"><h2>Feedback</h2></div>
      {qr && <QrModal {...qr} onClose={() => setQr(null)} />}
      {err && <p className="err">{err}</p>}
      {!list ? <p className="muted">Loading…</p> : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Training</th><th>Dates</th><th>Responses</th><th style={{ width: 280 }}>Actions</th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}{t.batch && <span className="pill soft mini" style={{ marginLeft: 6 }}>{t.batch}</span>}
                    {t.external_form_url && <span className="pill warn mini" style={{ marginLeft: 6 }} title="The QR/link redirects to this Microsoft Form">MS Form</span>}</td>
                  <td className="muted">{fmtRange(t.days)}</td>
                  <td>{t.response_count} / {t.participant_count}</td>
                  <td>
                    {isAdmin && <button className="btn link" onClick={() => openRespond(t)}>Respond</button>}
                    <button className="btn link" onClick={() => openResults(t)}>Results</button>
                    {isAdmin && <button className="btn link" onClick={() => openBuilder(t)}>Edit form</button>}
                    {isAdmin && <button className="btn link" onClick={() => openImport(t)}>Import</button>}
                    {isAdmin && t.public_token && (
                      <button className="btn link" onClick={() => setQr({
                        title: 'Feedback QR — ' + t.title,
                        url: `${location.origin}/p/fb/${t.public_token}`,
                        desc: 'Scan or share the link — responses tag to this training automatically, no sign-in needed.',
                      })}>▦ QR / Link</button>
                    )}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={4} className="muted">No trainings yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {importing && (
        <FbImport t={importing.t} participants={importing.participants}
          onClose={() => setImporting(null)}
          onDone={(msg) => { setImporting(null); toast(msg); load(); }} />
      )}

      {respond && (
        <div className="modal-backdrop" onClick={() => setRespond(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Feedback — {respond.t.title}</h3>
            {respond.mine && <p className="muted mini">You already responded; submitting again updates your response.</p>}
            {respond.questions.map((q, i) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>{q}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button key={v} className="btn" style={respond.scores[i] === v
                      ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
                      onClick={() => setRespond({ ...respond, scores: { ...respond.scores, [i]: v } })}>{v}</button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 10 }}>
              <label className="muted mini">What should be improved? (optional)</label>
              <input style={{ width: '100%', marginTop: 4 }} value={respond.comment}
                onChange={(e) => setRespond({ ...respond, comment: e.target.value })} />
            </div>
            <div className="form-actions">
              <button className="btn gold"
                disabled={!respond.questions.every((q, i) => respond.scores[i] >= 1)}
                onClick={submit}>Submit feedback</button>
              <button className="btn" onClick={() => setRespond(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {results && (
        <div className="modal-backdrop" onClick={() => setResults(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <h3>Results — {results.t.title}</h3>
            <p className="muted mini">{results.responses.length} response(s) · scale 1–5</p>
            {results.external_form_url && (
              <p className="muted mini">This training collects feedback on a <a href={results.external_form_url} target="_blank" rel="noreferrer">Microsoft Form</a> —
                export responses there and use <b>Import</b> to bring the scores in.</p>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Respondent</th>{results.questions.map((q, i) =>
                  <th key={i} title={q} style={{ textAlign: 'right' }}>Q{i + 1}</th>)}<th>Submitted at</th><th>Comment</th></tr></thead>
                <tbody>
                  {results.responses.map((r, ri) => (
                    <tr key={ri}><td>{r.respondent}</td>
                      {results.questions.map((q, i) => <td key={i} style={{ textAlign: 'right' }}>{r.scores[i] || '—'}</td>)}
                      <td className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString('en-IN')}</td>
                      <td className="muted mini">{r.comment}</td></tr>
                  ))}
                  {results.responses.length > 0 && (
                    <tr style={{ fontWeight: 700 }}><td>Average</td>
                      {results.questions.map((q, i) => <td key={i} style={{ textAlign: 'right' }}>{avg(results.responses, i)}</td>)}
                      <td /><td /></tr>
                  )}
                  {!results.responses.length && <tr><td colSpan={results.questions.length + 3} className="muted">No responses yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="muted mini" style={{ marginTop: 8 }}>
              {results.questions.map((q, i) => `Q${i + 1}: ${q}`).join(' · ')}
            </p>
            <div className="form-actions">
              {isAdmin && <button className="btn gold" onClick={() => exportResults(results)}>⬇ Excel</button>}
              <button className="btn" onClick={() => setResults(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {builder && (
        <div className="modal-backdrop" onClick={() => setBuilder(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Feedback form — {builder.t.title}</h3>
            <p className="muted mini">Standard questions — untick what you don't need:</p>
            {STD_QS.map((q) => (
              <label key={q} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={builder.checked.has(q)} onChange={(e) => {
                  const c = new Set(builder.checked);
                  e.target.checked ? c.add(q) : c.delete(q);
                  setBuilder({ ...builder, checked: c });
                }} /> {q}
              </label>
            ))}
            <p className="muted mini" style={{ marginTop: 10 }}>Custom questions for this training:</p>
            {builder.custom.map((q, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 13 }}>
                <span style={{ flex: 1 }}>{q}</span>
                <button className="btn link" onClick={() => setBuilder({ ...builder, custom: builder.custom.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input style={{ flex: 1 }} placeholder="Type a question…" value={builder.newQ}
                onChange={(e) => setBuilder({ ...builder, newQ: e.target.value })} />
              <button className="btn" disabled={!builder.newQ.trim()}
                onClick={() => setBuilder({ ...builder, custom: [...builder.custom, builder.newQ.trim()], newQ: '' })}>+ Add</button>
            </div>
            <p className="muted mini" style={{ marginTop: 14, marginBottom: 4 }}>
              <b>Or use a Microsoft Form instead:</b> paste its share link and the same QR / link sends
              participants to that form (the questions above are then not shown).
            </p>
            <input style={{ width: '100%' }} placeholder="https://forms.office.com/… (leave empty to use the questions above)"
              value={builder.ext} onChange={(e) => setBuilder({ ...builder, ext: e.target.value })} />
            {builder.ext.trim() && (
              <p className="muted mini" style={{ marginTop: 4 }}>
                Responses will be collected in Microsoft Forms — export them there and use this training's
                <b> Import</b> button to bring the scores into the hub.
              </p>
            )}
            <div className="form-actions">
              <button className="btn gold" disabled={builder.checked.size + builder.custom.length < 1} onClick={saveForm}>Save form</button>
              <button className="btn" onClick={() => setBuilder(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
