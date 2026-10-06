import React, { useState } from 'react';
import { api, ENTITIES, ENTITY_NAMES, inr } from '../api.js';
import { useSettings, useToast } from '../App.jsx';

const LISTS = [
  { key: 'divisions', label: 'Divisions', hint: 'Business lines shown on employees, assessments and filters.' },
  { key: 'departments', label: 'Departments', hint: 'Functions shown on employees and filters.' },
  { key: 'emp_types', label: 'Employment types', hint: 'Options in the employee form.' },
  { key: 'trn_categories', label: 'Training categories', hint: 'Options when planning a training.' },
  { key: 'exp_categories', label: 'Expense categories', hint: 'Cost heads on expense records.' },
  { key: 'joiner_steps', label: 'New-joiner checklist steps', hint: 'Tracked per joiner on the New Joiners tab.' },
];

// Optional employee-form fields an admin can promote to mandatory.
const EMP_FIELDS = [
  ['zoho_emp_id', 'Zoho employee ID'], ['email', 'Official e-mail'], ['mobile', 'Mobile'],
  ['division', 'Division'], ['department', 'Department'], ['designation', 'Designation'],
  ['manager', 'Reporting manager'], ['date_joined', 'Date of joining'], ['location', 'Location'],
];

export default function Settings() {
  const { settings, reloadSettings } = useSettings();
  const toast = useToast();
  const [newItem, setNewItem] = useState({});
  const [smtp, setSmtp] = useState(null);   // local draft of the e-mail settings
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState(null);

  if (!settings) return <p className="muted">Loading…</p>;
  const sm = smtp || { ...settings.smtp, pass: '' };

  const saveSmtp = async () => {
    setErr(null);
    try {
      await api.put('/api/settings/smtp', { value: sm });
      reloadSettings(); setSmtp(null);
      toast('E-mail settings saved.');
    } catch (e) { setErr(e.message); }
  };
  const testMail = async () => {
    setTesting(true); setErr(null);
    try {
      const r = await api.post('/api/settings/test-mail', {});
      toast(`Test e-mail sent to ${r.to} — check the inbox.`);
    } catch (e) { setErr(e.message); }
    setTesting(false);
  };

  const save = async (key, value, msg) => {
    setErr(null);
    try {
      await api.put('/api/settings/' + key, { value });
      reloadSettings();
      toast(msg || 'Setting saved — applies across the application immediately.');
    } catch (e) { setErr(e.message); }
  };

  const req = settings.required_employee_fields || [];

  return (
    <>
      <div className="page-head"><h2>Settings</h2></div>
      <p className="muted" style={{ marginBottom: 16, fontSize: 13 }}>
        Customise the application without a code change. Every change is logged to the audit trail and applies immediately for everyone.
      </p>
      {err && <p className="err">{err}</p>}

      <div className="cols2">
        {LISTS.map((l) => (
          <div key={l.key} className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15 }}>{l.label} <span className="pill soft mini">{(settings[l.key] || []).length}</span></h3>
            <p className="muted mini" style={{ margin: '4px 0 0' }}>{l.hint}</p>
            <div className="chiprow">
              {(settings[l.key] || []).map((item) => (
                <span key={item} className="tagchip">{item}
                  <button title={`Remove "${item}"`}
                    onClick={() => save(l.key, settings[l.key].filter((x) => x !== item), `"${item}" removed from ${l.label}. Existing records keep their old value.`)}>✕</button>
                </span>
              ))}
              {!(settings[l.key] || []).length && <span className="muted mini">Empty — add the first item below.</span>}
            </div>
            <div className="addrow">
              <input placeholder={`Add to ${l.label.toLowerCase()}…`} value={newItem[l.key] || ''}
                onChange={(e) => setNewItem({ ...newItem, [l.key]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const v = (newItem[l.key] || '').trim();
                  if (!v) return;
                  if ((settings[l.key] || []).includes(v)) return setErr(`"${v}" is already in ${l.label}.`);
                  save(l.key, [...(settings[l.key] || []), v], `"${v}" added to ${l.label}.`);
                  setNewItem({ ...newItem, [l.key]: '' });
                }} />
              <button className="btn gold" disabled={!(newItem[l.key] || '').trim()}
                onClick={() => {
                  const v = newItem[l.key].trim();
                  if ((settings[l.key] || []).includes(v)) return setErr(`"${v}" is already in ${l.label}.`);
                  save(l.key, [...(settings[l.key] || []), v], `"${v}" added to ${l.label}.`);
                  setNewItem({ ...newItem, [l.key]: '' });
                }}>+ Add</button>
            </div>
          </div>
        ))}

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Mandatory employee fields</h3>
          <p className="muted mini" style={{ margin: '4px 0 0' }}>
            Name and entity are always required. Tap a chip to make that field mandatory (gold = mandatory).
          </p>
          <div className="chiprow">
            {EMP_FIELDS.map(([key, label]) => (
              <button key={key} className={'togglechip' + (req.includes(key) ? ' on' : '')}
                onClick={() => save('required_employee_fields',
                  req.includes(key) ? req.filter((x) => x !== key) : [...req, key],
                  `"${label}" is ${req.includes(key) ? 'optional again' : 'now mandatory'} on the employee form.`)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Annual training budgets (₹, per entity)</h3>
          <p className="muted mini" style={{ margin: '4px 0 10px' }}>
            Drives the Budget vs actual table on Expenses and the dashboard spend tile.
          </p>
          {ENTITIES.map((e) => (
            <div key={e} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{ENTITY_NAMES[e]}</span>
              <input type="number" min="0" style={{ width: 140 }}
                defaultValue={settings.entity_budgets?.[e] ?? 0}
                onBlur={(ev) => {
                  const v = Number(ev.target.value) || 0;
                  if (v !== (settings.entity_budgets?.[e] ?? 0)) {
                    save('entity_budgets', { ...settings.entity_budgets, [e]: v }, `${e} budget set to ₹${inr(v)}.`);
                  }
                }} />
            </div>
          ))}
          <p className="muted mini" style={{ marginTop: 8 }}>
            Total: ₹{inr(ENTITIES.reduce((a, e) => a + (Number(settings.entity_budgets?.[e]) || 0), 0))} per financial year.
          </p>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>E-mail notifications (Outlook / Microsoft 365)</h3>
          <p className="muted mini" style={{ margin: '4px 0 10px' }}>
            When someone is nominated or assigned to a training, they get an Outlook e-mail from the
            mailbox below, and a summary goes to the notify address. Mails never block the nomination —
            failures are only logged.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={sm.enabled} onChange={(e) => setSmtp({ ...sm, enabled: e.target.checked })} />
            Send nomination / assignment e-mails
          </label>
          <div className="form-grid">
            <div><label>Mailbox (Microsoft 365 sign-in)</label>
              <input value={sm.user} onChange={(e) => setSmtp({ ...sm, user: e.target.value })} placeholder="lokshni@avanasurgical.com" /></div>
            <div><label>App password {settings.smtp?.has_pass ? '(saved — leave blank to keep)' : '*'}</label>
              <input type="password" value={sm.pass} onChange={(e) => setSmtp({ ...sm, pass: e.target.value })}
                placeholder={settings.smtp?.has_pass ? '••••••••' : 'paste the app password'} autoComplete="new-password" /></div>
            <div><label>Send as (From)</label>
              <input value={sm.from} onChange={(e) => setSmtp({ ...sm, from: e.target.value })} /></div>
            <div><label>Notify L&amp;D copy to</label>
              <input value={sm.notify} onChange={(e) => setSmtp({ ...sm, notify: e.target.value })} placeholder="lokshni@avanasurgical.com" /></div>
          </div>
          <p className="muted mini" style={{ marginTop: 8 }}>
            Server: smtp.office365.com, port 587. If sign-in fails, the mailbox needs <b>SMTP AUTH</b> enabled and an
            <b> app password</b> (Microsoft 365 admin center → user → Mail → Manage email apps → Authenticated SMTP;
            app password via Security info when MFA is on). The password is stored on your server only and never shown again.
          </p>
          <div className="form-actions">
            <button className="btn gold" onClick={saveSmtp}>Save e-mail settings</button>
            <button className="btn" disabled={testing} onClick={testMail}>{testing ? 'Sending…' : '✉ Send test e-mail'}</button>
          </div>
        </div>
      </div>
    </>
  );
}
