import React, { useEffect, useState } from 'react';
import { api, fmtRange } from '../api.js';
import { useAuth, useToast } from '../App.jsx';
import { toXlsx } from '../xlsx.js';
import QrModal from '../components/QrModal.jsx';

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

  const openBuilder = async (t) => {
    try {
      const d = await api.get('/api/feedback/' + t.id);
      const current = d.questions || [];
      setBuilder({
        t,
        checked: new Set(STD_QS.filter((q) => current.includes(q))),
        custom: current.filter((q) => !STD_QS.includes(q)),
        newQ: '',
      });
    } catch (e) { setErr(e.message); }
  };
  const saveForm = async () => {
    try {
      const questions = [...STD_QS.filter((q) => builder.checked.has(q)), ...builder.custom];
      await api.put(`/api/feedback/${builder.t.id}/form`, { questions });
      toast(`Feedback form saved — ${questions.length} questions.`);
      setBuilder(null);
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
                  <td>{t.title}{t.batch && <span className="pill soft mini" style={{ marginLeft: 6 }}>{t.batch}</span>}</td>
                  <td className="muted">{fmtRange(t.days)}</td>
                  <td>{t.response_count} / {t.participant_count}</td>
                  <td>
                    <button className="btn link" onClick={() => openRespond(t)}>Respond</button>
                    <button className="btn link" onClick={() => openResults(t)}>Results</button>
                    {isAdmin && <button className="btn link" onClick={() => openBuilder(t)}>Edit form</button>}
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
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Respondent</th>{results.questions.map((q, i) =>
                  <th key={i} title={q} style={{ textAlign: 'right' }}>Q{i + 1}</th>)}<th>Comment</th></tr></thead>
                <tbody>
                  {results.responses.map((r, ri) => (
                    <tr key={ri}><td>{r.respondent}</td>
                      {results.questions.map((q, i) => <td key={i} style={{ textAlign: 'right' }}>{r.scores[i] || '—'}</td>)}
                      <td className="muted mini">{r.comment}</td></tr>
                  ))}
                  {results.responses.length > 0 && (
                    <tr style={{ fontWeight: 700 }}><td>Average</td>
                      {results.questions.map((q, i) => <td key={i} style={{ textAlign: 'right' }}>{avg(results.responses, i)}</td>)}
                      <td /></tr>
                  )}
                  {!results.responses.length && <tr><td colSpan={results.questions.length + 2} className="muted">No responses yet.</td></tr>}
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
