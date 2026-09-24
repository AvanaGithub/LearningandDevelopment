import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// Phone page opened by scanning a training's feedback QR (or its shared
// link). Responses tag to that training automatically.
export default function PublicFeedback() {
  const { token } = useParams();
  const [t, setT] = useState(null);
  const [emp, setEmp] = useState('');
  const [scores, setScores] = useState({});
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch('/api/public/training/' + token)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error)))))
      .then(setT)
      .catch((e) => setErr(e.message));
  }, [token]);

  const submit = async () => {
    setErr(null);
    try {
      const r = await fetch('/api/public/fb/' + token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: emp ? Number(emp) : null, scores, comment }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not submit');
      setDone(true);
    } catch (e) { setErr(e.message); }
  };

  const complete = t && t.questions.every((q, i) => scores[i] >= 1);

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'left', maxWidth: 460 }}>
        <h1 style={{ fontSize: 18, textAlign: 'center' }}>Avana Learning Hub</h1>
        {!t && !err && <p className="muted" style={{ textAlign: 'center' }}>Loading…</p>}
        {err && !t && <p className="login-err">{err}</p>}
        {t && done && (
          <div style={{ textAlign: 'center', padding: '14px 0' }}>
            <div style={{ fontSize: 52, color: 'var(--good)' }}>✓</div>
            <h2 style={{ fontSize: 17, margin: '8px 0 2px' }}>Feedback submitted!</h2>
            <p className="muted mini">Tagged to {t.title}. Thank you.</p>
          </div>
        )}
        {t && !done && (
          <>
            <p className="login-sub" style={{ textAlign: 'center' }}>
              Feedback · <b>{t.title}{t.batch ? ' — ' + t.batch : ''}</b>
            </p>
            <label className="muted mini">I am</label>
            <select style={{ width: '100%', margin: '4px 0 8px' }} value={emp} onChange={(e) => setEmp(e.target.value)}>
              <option value="">— select your name —</option>
              {(t.participants || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {t.questions.map((q, i) => (
              <div key={i} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>{q}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button key={v} type="button" className="btn" style={scores[i] === v
                      ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
                      onClick={() => setScores({ ...scores, [i]: v })}>{v}</button>
                  ))}
                </div>
              </div>
            ))}
            <input style={{ width: '100%', margin: '10px 0' }} placeholder="What should be improved? (optional)"
              value={comment} onChange={(e) => setComment(e.target.value)} />
            {err && <p className="login-err">{err}</p>}
            <button className="btn-primary" disabled={!complete} onClick={submit}>Submit feedback</button>
          </>
        )}
      </div>
    </div>
  );
}
