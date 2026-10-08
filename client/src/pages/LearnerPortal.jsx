import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtRange, statusPill, TRN_STATUSES } from '../api.js';
import { useAuth, useToast } from '../App.jsx';

// The learner's own portal: my trainings (check-in, feedback), trainings
// open for self-nomination, and the upcoming calendar. No staff data.
export default function LearnerPortal() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const previewing = user.real_role === 'super_admin';
  const [data, setData] = useState(null);
  const [fb, setFb] = useState(null);           // {t, scores, comment}
  const [slots, setSlots] = useState({});       // training_id -> chosen slot
  const [err, setErr] = useState(null);

  const load = () => api.get('/api/learner/overview').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    refresh();
  };
  const exitPreview = async () => {
    await fetch('/auth/view-as', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: null }),
    });
    refresh();
  };

  const checkin = async (t) => {
    try {
      await api.post('/api/learner/checkin', { training_id: t.id });
      toast(`Marked present for ${t.title} today ✓`);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const nominate = async (t) => {
    try {
      await api.post('/api/learner/nominate', { training_id: t.id, slot: slots[t.id] || '' });
      toast(`You are nominated for ${t.title} ✓`);
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const sendFb = async () => {
    try {
      await api.post('/api/learner/feedback', { training_id: fb.t.id, scores: fb.scores, comment: fb.comment });
      toast('Feedback submitted — thank you!');
      setFb(null); load();
    } catch (e2) { setErr(e2.message); }
  };

  const markOf = (t, day) => (t.my_attendance || []).find((a) => a.day.slice(0, 10) === day.slice(0, 10))?.mark;

  return (
    <div className="shell" style={{ display: 'block' }}>
      <div className="topbar">
        <div className="brand">Learning Hub<small>MY LEARNING · AVANA GROUP</small></div>
        <div className="spacer" />
        <div className="who"><b>{user.name}</b> · Learner</div>
        <button className="btn-ghost" onClick={logout}>Sign out</button>
      </div>
      {previewing && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
          background: 'var(--gold, #c8930a)', color: '#fff', padding: '8px 16px', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>👁 Previewing the <b>Learner</b> portal — this is exactly what an employee with learner access sees.</span>
          <button className="btn" style={{ marginLeft: 'auto', padding: '2px 10px' }} onClick={exitPreview}>Exit preview</button>
        </div>
      )}

      <main className="main" style={{ marginLeft: 0, paddingTop: 76, maxWidth: 900, marginInline: 'auto' }}>
        {err && <p className="err">{err}</p>}
        {!data ? <p className="muted">Loading…</p> : !data.employee ? (
          <div className="card">
            <h2 style={{ fontSize: 17 }}>Welcome!</h2>
            <p className="muted" style={{ fontSize: 13 }}>
              No employee record matches your e-mail ({user.email}) yet, so your trainings cannot be shown.
              Please contact L&amp;D to link your employee profile.
            </p>
          </div>
        ) : (
          <>
            <div className="page-head"><h2>My trainings</h2></div>
            {!data.my.length && <p className="muted">You are not on any training yet — check "Open for nomination" below.</p>}
            {data.my.map((t) => {
              const days = (t.days || []).map((d) => d.slice(0, 10));
              const todayIsDay = days.includes(data.today);
              const markedToday = todayIsDay && markOf(t, data.today);
              return (
                <div key={t.id} className="card">
                  <div className="toolbar" style={{ marginBottom: 6, alignItems: 'center' }}>
                    <b style={{ fontFamily: 'Fira Sans' }}>{t.title}{t.batch ? ' — ' + t.batch : ''}</b>
                    <span className="pill soft mini">{fmtRange(t.days)}</span>
                    <span className={'pill mini ' + statusPill(t.status)}>{TRN_STATUSES[t.status]}</span>
                    {t.nom_slot && <span className="pill warn mini">Slot: {t.nom_slot}</span>}
                    <span style={{ flex: 1 }} />
                    {t.agenda_file && <a className="btn" style={{ textDecoration: 'none' }} href={'/api/files/' + t.agenda_file} target="_blank" rel="noreferrer">📄 Agenda</a>}
                    {todayIsDay && !markedToday && <button className="btn gold" onClick={() => checkin(t)}>✓ Check in today</button>}
                    {markedToday && <span className="pill good mini">Present today ✓</span>}
                    {t.feedback_given
                      ? <span className="pill good mini">Feedback given ✓</span>
                      : t.external_form_url
                        ? <a className="btn" style={{ textDecoration: 'none' }} href={t.external_form_url} target="_blank" rel="noreferrer">Give feedback</a>
                        : <button className="btn" onClick={() => setFb({ t, scores: {}, comment: '' })}>Give feedback</button>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {days.map((d) => {
                      const m = markOf(t, d);
                      return <span key={d} className={'pill mini ' + (m === 'P' ? 'good' : m === 'H' ? 'warn' : m ? 'crit' : 'neutral')}>
                        {fmtDate(d)}{m ? ` · ${m}` : ''}
                      </span>;
                    })}
                  </div>
                </div>
              );
            })}

            <div className="page-head" style={{ marginTop: 18 }}><h2>Open for nomination</h2></div>
            {!data.open.length && <p className="muted">Nothing is open for self-nomination right now — trainings you are already on don't appear here.</p>}
            {data.open.map((t) => (
              <div key={t.id} className="card">
                <div className="toolbar" style={{ marginBottom: 0, alignItems: 'center' }}>
                  <b style={{ fontFamily: 'Fira Sans' }}>{t.title}{t.batch ? ' — ' + t.batch : ''}</b>
                  <span className="pill soft mini">{fmtRange(t.days)}</span>
                  {t.nom_deadline && <span className="muted mini">nominate by {fmtDate(t.nom_deadline)}</span>}
                  <span style={{ flex: 1 }} />
                  {(t.days || []).length > 1 && (
                    <select value={slots[t.id] || ''} onChange={(e) => setSlots({ ...slots, [t.id]: e.target.value })}>
                      <option value="">Any day</option>
                      {t.days.map((d) => <option key={d} value={fmtDate(d)}>{fmtDate(d)}</option>)}
                    </select>
                  )}
                  <button className="btn gold" onClick={() => nominate(t)}>Nominate myself</button>
                </div>
              </div>
            ))}

            <div className="page-head" style={{ marginTop: 18 }}><h2>Upcoming trainings</h2></div>
            <div className="card" style={{ padding: 0 }}>
              <table>
                <tbody>
                  {data.upcoming.map((t) => (
                    <tr key={t.id}>
                      <td className="muted" style={{ whiteSpace: 'nowrap', width: 140 }}>{fmtRange(t.days)}</td>
                      <td>{t.title}{t.batch ? ' — ' + t.batch : ''}</td>
                      <td className="muted">{t.mode || ''}</td>
                    </tr>
                  ))}
                  {!data.upcoming.length && <tr><td className="muted">Nothing scheduled yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {fb && (
        <div className="modal-backdrop" onClick={() => setFb(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Feedback — {fb.t.title}</h3>
            {fb.t.questions.map((q, i) => (
              <div key={i} style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>{q}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button key={v} type="button" className="btn" style={fb.scores[i] === v
                      ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
                      onClick={() => setFb({ ...fb, scores: { ...fb.scores, [i]: v } })}>{v}</button>
                  ))}
                </div>
              </div>
            ))}
            <input style={{ width: '100%', margin: '10px 0' }} placeholder="What should be improved? (optional)"
              value={fb.comment} onChange={(e) => setFb({ ...fb, comment: e.target.value })} />
            <div className="form-actions">
              <button className="btn gold" disabled={!fb.t.questions.every((q, i) => fb.scores[i] >= 1)} onClick={sendFb}>Submit feedback</button>
              <button className="btn" onClick={() => setFb(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
