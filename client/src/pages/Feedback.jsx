import React, { useEffect, useState } from 'react';
import { api, apiUpload, fmtRange, qText, qIsText, qIsFile } from '../api.js';
import FileAnswer from '../components/FileAnswer.jsx';
import { useAuth, useToast, useSettings } from '../App.jsx';
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
      if (!headers.length) throw new Error('The first sheet needs a header row.');
      const low = headers.map((h) => h.toLowerCase());
      const guessId = low.findIndex((h) => /emp|zoho|e-?mail|name|participant|respondent/.test(h));
      // Classify each column: rating (most filled cells are 1–5), text
      // (open answers — imported verbatim), or empty. With no response
      // rows yet, guess from the wording (adjustable after import).
      const guessText = (h) => /what|suggest|improve|comment|describe|any other|useful|why/i.test(h);
      const guessFile = (h) => /upload|screenshot|attach|photo|certificate/i.test(h);
      const kinds = headers.map((h, i) => {
        if (guessFile(h)) return 'file';
        const vals = rows.map((r) => String(r[i] ?? '').trim()).filter(Boolean);
        if (!vals.length) return rows.length ? 'empty' : (guessText(h) ? 'text' : 'rating');
        const ok = vals.filter((v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5).length;
        return ok / vals.length >= 0.5 ? 'rating' : 'text';
      });
      const qSel = new Set(headers.map((h, i) => i).filter((i) =>
        i !== guessId && !META.test(headers[i]) && kinds[i] !== 'empty' &&
        (kinds[i] === 'rating' || /\?|^q\s*\d/i.test(headers[i]))));
      setIdCol(guessId >= 0 ? guessId : 0);
      setCCol('');
      setSheet({ headers, rows, qSel, kinds });
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
      const questions = qIdx.map((i) => {
        const h = sheet.headers[i] || `Question ${i + 1}`;
        return sheet.kinds[i] === 'rating' ? h : { q: h, type: sheet.kinds[i] === 'file' ? 'file' : 'text' };
      });
      // No responses yet: import just the questions — the QR / learner
      // form shows them from now on, results collect in the hub.
      if (!sheet.rows.length) {
        await api.post(`/api/feedback/${t.id}/import`, { questions, rows: [] });
        onDone(`${questions.length} question(s) imported from the sheet — the QR and learner feedback form now show them.`);
        return;
      }
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
          const raw = String(r[col] ?? '').trim();
          if (!raw) return;
          const v = Number(raw);
          if (sheet.kinds[col] === 'rating' && Number.isInteger(v) && v >= 1 && v <= 5) scores[i] = v;
          else if (sheet.kinds[col] !== 'rating') scores[i] = raw.slice(0, 1000);
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
              These sheet columns become this training's questions — ratings count in averages,
              text answers are imported word-for-word. Untick anything that isn't a question:
            </p>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {sheet.headers.map((h, i) => (i === idCol || i === cCol) ? null : (
                <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={sheet.qSel.has(i)} onChange={() => toggleQ(i)} />
                  <span style={{ flex: 1 }}>{h || `Column ${i + 1}`}</span>
                  {sheet.qSel.has(i)
                    ? <span className={'pill mini ' + (sheet.kinds[i] === 'rating' ? 'good' : 'soft')}>{sheet.kinds[i] === 'rating' ? '1–5 rating' : 'text'}</span>
                    : <span className="muted mini">{sheet.kinds[i] === 'empty' ? 'empty · ignored' : 'ignored'}</span>}
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
  const { settings } = useSettings();
  const toast = useToast();
  const isAdmin = me.role === 'admin' || me.role === 'super_admin';
  const stdQs = settings?.fb_std_questions || STD_QS;
  const [list, setList] = useState(null);
  const [respond, setRespond] = useState(null);   // {t, questions, scores, comment}
  const [results, setResults] = useState(null);   // {t, questions, responses}
  const [builder, setBuilder] = useState(null);   // {t, checked:Set(labels), custom:[], newQ}
  const [importing, setImporting] = useState(null); // {t, questions, participants}
  const [qr, setQr] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState(null);

  const exportResults = (r) => toXlsx(
    ('Feedback-' + r.t.code + '.xlsx').replace(/[^\w.-]+/g, '-'),
    ['Respondent', 'Status', ...r.questions.map((q, i) => `Q${i + 1} ${qText(q)}`), 'Comment'],
    [...r.responses.map((x) => [x.respondent, 'Responded',
      ...r.questions.map((q, i) => (Array.isArray(x.scores[i]) ? x.scores[i].map((f) => f.name).join('; ') : (x.scores[i] ?? ''))),
      x.comment || '']),
     ...(r.pending || []).map((p) => [p.name, 'NOT responded', ...r.questions.map(() => ''), ''])],
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
        checked: new Set(stdQs.filter((q) => current.some((c) => typeof c === 'string' && c === q))),
        custom: current.filter((c) => qIsText(c) || qIsFile(c) || !stdQs.includes(c))
          .map((c) => ({ q: qText(c), type: qIsFile(c) ? 'file' : qIsText(c) ? 'text' : 'rating' })),
        newQ: '', paste: '',
        ext: d.external_form_url || '',
        wb: d.fb_workbook_url || '',
      });
    } catch (e) { setErr(e.message); }
  };
  const saveForm = async () => {
    try {
      const questions = [...stdQs.filter((q) => builder.checked.has(q)),
        ...builder.custom.map((c) => (c.type === 'rating' ? c.q : { q: c.q, type: c.type }))];
      const body = { external_form_url: builder.ext.trim() || null, workbook_url: builder.wb.trim() || null };
      if (questions.length) body.questions = questions;
      await api.put(`/api/feedback/${builder.t.id}/form`, body);
      toast(builder.ext.trim()
        ? 'Saved — the QR/link now sends participants to the Microsoft Form (all Forms elements and branching work there).'
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
                    {t.external_form_url && <span className="pill warn mini" style={{ marginLeft: 6 }} title="The QR/link redirects to this Microsoft Form">MS Form</span>}
                    {t.feedback_open && <span className="pill good mini" style={{ marginLeft: 6 }} title="Learners on this training see the feedback option">open</span>}</td>
                  <td className="muted">{fmtRange(t.days)}</td>
                  <td>{t.response_count} / {t.participant_count}</td>
                  <td>
                    {isAdmin && (t.external_form_url
                      ? <a className="btn link" href={t.external_form_url} target="_blank" rel="noreferrer">Respond</a>
                      : <button className="btn link" onClick={() => openRespond(t)}>Respond</button>)}
                    <button className="btn link" onClick={() => openResults(t)}>Results</button>
                    {isAdmin && <button className="btn link" onClick={() => openBuilder(t)}>Edit form</button>}
                    {isAdmin && <button className="btn link" onClick={() => openImport(t)}>Import</button>}
                    {isAdmin && (
                      <button className="btn link" style={t.feedback_open ? { color: 'var(--crit)' } : {}}
                        title="Controls whether learners see the feedback option on their portal"
                        onClick={async () => {
                          try {
                            await api.post(`/api/feedback/${t.id}/open`, { open: !t.feedback_open });
                            toast(t.feedback_open
                              ? `Feedback closed for ${t.title} — hidden from learner portals.`
                              : `Feedback opened for ${t.title} — learners on it now see "Give feedback".`);
                            load();
                          } catch (e2) { setErr(e2.message); }
                        }}>
                        {t.feedback_open ? 'Close learner feedback' : 'Open learner feedback'}
                      </button>
                    )}
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
                <div style={{ fontSize: 13, marginBottom: 6 }}>{qText(q)}{(qIsText(q) || qIsFile(q)) && <span className="muted"> (optional)</span>}</div>
                {qIsFile(q) ? (
                  <FileAnswer value={respond.scores[i]} uploadTo={(fl) => apiUpload(fl)}
                    onChange={(v) => setRespond({ ...respond, scores: { ...respond.scores, [i]: v } })} />
                ) : qIsText(q) ? (
                  <textarea rows={2} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
                    value={respond.scores[i] || ''} onChange={(e) => setRespond({ ...respond, scores: { ...respond.scores, [i]: e.target.value } })} />
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[1, 2, 3, 4, 5].map((v) => (
                      <button key={v} className="btn" style={respond.scores[i] === v
                        ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
                        onClick={() => setRespond({ ...respond, scores: { ...respond.scores, [i]: v } })}>{v}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div style={{ marginTop: 10 }}>
              <label className="muted mini">What should be improved? (optional)</label>
              <input style={{ width: '100%', marginTop: 4 }} value={respond.comment}
                onChange={(e) => setRespond({ ...respond, comment: e.target.value })} />
            </div>
            <div className="form-actions">
              <button className="btn gold"
                disabled={!respond.questions.every((q, i) => qIsText(q) || qIsFile(q) || respond.scores[i] >= 1)}
                onClick={submit}>Submit feedback</button>
              <button className="btn" onClick={() => setRespond(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {results && (
        <div className="modal-backdrop" onClick={() => setResults(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980 }}>
            <h3>Results — {results.t.title}</h3>
            <p className="muted mini">
              {results.responses.length} of {results.participant_count ?? results.responses.length} participant(s) responded
              {(results.pending || []).length > 0 && <> · <b style={{ color: 'var(--crit)' }}>{results.pending.length} pending</b></>}
              {' '}· scale 1–5
            </p>
            {results.external_form_url && (
              <p className="muted mini" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>
                  This training collects feedback on a <a href={results.external_form_url} target="_blank" rel="noreferrer">Microsoft Form</a>
                  {results.fb_workbook_url
                    ? <> — responses <b>sync automatically</b> every hour.
                        {results.fb_last_synced && <> Last checked {new Date(results.fb_last_synced).toLocaleString('en-IN')}.</>}
                        {results.fb_sync_error && <span style={{ color: 'var(--crit)' }}> Sync problem: {results.fb_sync_error}</span>}</>
                    : <> — link its response workbook in <b>Edit form</b> for automatic sync, or use <b>Import</b>.</>}
                </span>
                {isAdmin && results.fb_workbook_url && (
                  <button className="btn" disabled={syncing} onClick={async () => {
                    setSyncing(true);
                    try {
                      const r = await api.post(`/api/feedback/${results.t.id}/sync`, {});
                      toast(`Synced — ${r.matched} respondent(s) matched${r.unmatched ? `, ${r.unmatched} not in the participant list` : ''}.`);
                      const d = await api.get('/api/feedback/' + results.t.id);
                      setResults({ t: results.t, ...d });
                      load();
                    } catch (e) {
                      // Show the problem inline (the stored sync_error line).
                      try {
                        const d = await api.get('/api/feedback/' + results.t.id);
                        setResults({ t: results.t, ...d });
                      } catch { setErr(e.message); }
                    }
                    setSyncing(false);
                  }}>⟳ Sync now</button>
                )}
              </p>
            )}
            {(results.pending || []).length > 0 && (
              <details style={{ margin: '6px 0 10px' }}>
                <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                  <b style={{ color: 'var(--crit)' }}>Not yet responded ({results.pending.length})</b> — click to view
                </summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  {results.pending.map((p) => (
                    <span key={p.id} className="pill crit mini" title={[p.zoho_emp_id, p.department].filter(Boolean).join(' · ')}>{p.name}</span>
                  ))}
                </div>
              </details>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Respondent</th>{results.questions.map((q, i) =>
                  <th key={i} style={{ textAlign: 'right', fontSize: 11, maxWidth: 150, minWidth: 70, whiteSpace: 'normal', verticalAlign: 'bottom' }}>{qText(q)}</th>)}<th>Submitted at</th><th>Comment</th></tr></thead>
                <tbody>
                  {results.responses.map((r, ri) => (
                    <tr key={ri}><td>{r.respondent}</td>
                      {results.questions.map((q, i) => (
                        <td key={i} title={Array.isArray(r.scores[i]) ? r.scores[i].map((f) => f.name).join(', ') : String(r.scores[i] ?? '')}
                          style={{ textAlign: 'right', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {Array.isArray(r.scores[i])
                            ? r.scores[i].map((f) => (
                              <a key={f.id} href={'/api/files/' + f.id} target="_blank" rel="noreferrer" style={{ marginLeft: 4 }}>📄</a>
                            ))
                            : (r.scores[i] ?? '—')}
                        </td>
                      ))}
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

            <p className="muted mini" style={{ marginBottom: 4 }}>
              <b>Microsoft Form (recommended):</b> paste the Form's share link. The QR and the feedback
              link send participants straight to it, so <b>everything Microsoft Forms offers works as-is</b> —
              Choice, Text, Rating, Ranking, Likert, File upload, Net Promoter Score, Sections and all
              branching logic. Design the form in Microsoft Forms; collect results there and bring them
              into the hub with this training's <b>Import</b> button.
            </p>
            <input style={{ width: '100%' }} placeholder="https://forms.office.com/…"
              value={builder.ext} onChange={(e) => setBuilder({ ...builder, ext: e.target.value })} />
            {builder.ext.trim()
              ? <p className="muted mini" style={{ marginTop: 4, color: 'var(--good)' }}>
                  The QR / link will open this Microsoft Form — the in-hub questions below are ignored while the link is set.
                </p>
              : <p className="muted mini" style={{ marginTop: 4 }}>No link — the QR shows the simple in-hub form below (1–5 ratings and text answers only).</p>}

            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginTop: 10 }}>
              Response workbook link (automatic response sync)</label>
            <input style={{ width: '100%' }} placeholder="https://… (Form → Responses → Open results in Excel → copy that file's share link)"
              value={builder.wb} onChange={(e) => setBuilder({ ...builder, wb: e.target.value })} />
            <p className="muted mini" style={{ marginTop: 4 }}>
              {builder.wb.trim()
                ? 'Responses pull in automatically every hour (plus a Sync now button on Results) — matched to the participants by their sign-in e-mail, so Results always shows who has completed and who is pending.'
                : 'Optional — in the Form\'s Responses tab choose "Open results in Excel", then paste that workbook\'s share link here. Responses then sync into Results automatically; without it, use Import.'}
            </p>

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Simple in-hub form (fallback when no Microsoft Form link is set)
              </summary>
            <p className="muted mini" style={{ marginTop: 8 }}>Standard questions — untick what you don't need:</p>
            {stdQs.map((q) => (
              <label key={q} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={builder.checked.has(q)} onChange={(e) => {
                  const c = new Set(builder.checked);
                  e.target.checked ? c.add(q) : c.delete(q);
                  setBuilder({ ...builder, checked: c });
                }} /> {q}
              </label>
            ))}
            <p className="muted mini" style={{ marginTop: 10 }}>Custom questions for this training:</p>
            {builder.custom.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 13 }}>
                <span style={{ flex: 1 }}>{c.q}</span>
                <select value={c.type} onChange={(e) => {
                  const custom = [...builder.custom]; custom[i] = { ...c, type: e.target.value };
                  setBuilder({ ...builder, custom });
                }}>
                  <option value="rating">1–5 rating</option>
                  <option value="text">Text answer</option>
                  <option value="file">File upload</option>
                </select>
                <button className="btn link" onClick={() => setBuilder({ ...builder, custom: builder.custom.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input style={{ flex: 1 }} placeholder="Type a question…" value={builder.newQ}
                onChange={(e) => setBuilder({ ...builder, newQ: e.target.value })} />
              <button className="btn" disabled={!builder.newQ.trim()}
                onClick={() => setBuilder({ ...builder, custom: [...builder.custom, { q: builder.newQ.trim(), type: 'rating' }], newQ: '' })}>+ Add</button>
            </div>
            <p className="muted mini" style={{ marginTop: 12, marginBottom: 4 }}>
              <b>Or paste the questions from your Microsoft Form</b> (one per line — they replace nothing, they are added as custom questions):
            </p>
            <textarea rows={4} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }} value={builder.paste || ''}
              placeholder={'How would you rate the trainer?\nWhat was the most useful part of the training?'}
              onChange={(e) => setBuilder({ ...builder, paste: e.target.value })} />
            <button className="btn" style={{ marginTop: 4 }} disabled={!(builder.paste || '').trim()}
              onClick={() => {
                const lines = builder.paste.split('\n')
                  .map((s) => s.replace(/^\s*(?:Q?\d+\s*[).:-]?)\s*/i, '').trim()).filter(Boolean);
                const guessText = (q) => /what|suggest|improve|comment|describe|any other|useful part|why/i.test(q);
                setBuilder({
                  ...builder,
                  custom: [...builder.custom, ...lines.map((q) => ({ q, type: guessText(q) ? 'text' : 'rating' }))],
                  paste: '',
                });
              }}>⇣ Add pasted questions</button>
            <p className="muted mini" style={{ marginTop: 2 }}>
              Open questions are guessed as "Text answer" — adjust the type dropdowns before saving.
            </p>
            </details>
            <div className="form-actions">
              <button className="btn gold" disabled={!builder.ext.trim() && builder.checked.size + builder.custom.length < 1}
                onClick={saveForm}>Save form</button>
              <button className="btn" onClick={() => setBuilder(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
