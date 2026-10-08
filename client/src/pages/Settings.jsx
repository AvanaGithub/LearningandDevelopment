import React, { useState } from 'react';
import { api, ENTITIES, ENTITY_NAMES, inr } from '../api.js';
import { useSettings, useToast } from '../App.jsx';

const LISTS = [
  { key: 'divisions', label: 'Divisions', icon: '🧭', hint: 'Business lines shown on employees, assessments and filters.' },
  { key: 'departments', label: 'Departments', icon: '🏢', hint: 'Functions shown on employees and filters.' },
  { key: 'emp_types', label: 'Employment types', icon: '🪪', hint: 'Options in the employee form.' },
  { key: 'trn_categories', label: 'Training categories', icon: '📚', hint: 'Options when planning a training.' },
  { key: 'exp_categories', label: 'Expense categories', icon: '🧾', hint: 'Cost heads on expense records.' },
  { key: 'joiner_steps', label: 'New-joiner checklist steps', icon: '🧷', hint: 'Tracked per joiner on the New Joiners tab.' },
];

// Optional fields an admin can promote to mandatory, per form. Enforced
// on the server, so the rule holds regardless of client.
const MANDATE_GROUPS = [
  {
    section: 'employees', label: 'Employees', icon: '👤', legacy: true,
    fields: [['zoho_emp_id', 'Zoho employee ID'], ['email', 'Official e-mail'], ['mobile', 'Mobile'],
      ['division', 'Division'], ['department', 'Department'], ['designation', 'Designation'],
      ['manager', 'Reporting manager'], ['date_joined', 'Date of joining'], ['location', 'Location']],
    note: 'Name and entity are always required.',
  },
  {
    section: 'trainings', label: 'Trainings', icon: '📚',
    fields: [['batch', 'Batch'], ['category', 'Category'], ['department', 'Departments'], ['division', 'Divisions'],
      ['mode', 'Mode'], ['validity_months', 'Re-training validity'], ['agenda_file', 'Training agenda']],
    note: 'Title, dates and trainer are always required.',
  },
  {
    section: 'expenses', label: 'Expenses', icon: '🧾',
    fields: [['budget', 'Approved budget'], ['dates', 'Training dates'], ['location', 'Location'],
      ['category', 'Category'], ['vendor', 'Vendor'], ['description', 'Description'],
      ['remark', 'Remark'], ['payments', 'Payment rows']],
    note: 'Training name, entity split and actual expense are always required.',
  },
  {
    section: 'mavericks', label: 'Mavericks batches', icon: '🚀',
    fields: [['mentor', 'Programme lead'], ['start_date', 'Start date'], ['end_date', 'End date'], ['notes', 'Notes']],
    note: 'Batch name is always required.',
  },
];

const Strip = ({ icon, children }) => (
  <div className="sect-strip"><span className="sicon">{icon}</span>{children}</div>
);

export default function Settings() {
  const { settings, reloadSettings } = useSettings();
  const toast = useToast();
  const [newItem, setNewItem] = useState({});
  const [smtp, setSmtp] = useState(null);   // local draft of the e-mail settings
  const [tplDraft, setTplDraft] = useState(null); // local draft of e-mail templates
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState(null);

  if (!settings) return <p className="muted">Loading…</p>;
  const sm = smtp || { ...settings.smtp, pass: '', client_secret: '' };

  const save = async (key, value, msg) => {
    setErr(null);
    try {
      await api.put('/api/settings/' + key, { value });
      reloadSettings();
      toast(msg || 'Setting saved — applies across the application immediately.');
    } catch (e) { setErr(e.message); }
  };

  const rf = settings.required_fields || { trainings: [], expenses: [], mavericks: [] };
  const reqOf = (g) => (g.legacy ? (settings.required_employee_fields || []) : (rf[g.section] || []));
  const toggleReq = (g, key, label) => {
    const cur = reqOf(g);
    const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
    const msg = `"${label}" is ${cur.includes(key) ? 'optional again' : 'now mandatory'} on the ${g.label} form.`;
    if (g.legacy) save('required_employee_fields', next, msg);
    else save('required_fields', { ...rf, [g.section]: next }, msg);
  };

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

  return (
    <>
      <div className="page-head"><h2>Settings</h2></div>
      <p className="muted" style={{ marginBottom: 6, fontSize: 13 }}>
        Customise the application without a code change. Every change is logged to the audit trail and applies immediately for everyone.
      </p>
      {err && <p className="err">{err}</p>}

      <Strip icon="🗂">Master lists</Strip>
      <div className="cols2">
        {LISTS.map((l) => (
          <div key={l.key} className="card scard" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15 }}><span className="sicon">{l.icon}</span>{l.label} <span className="pill soft mini">{(settings[l.key] || []).length}</span></h3>
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
      </div>

      <Strip icon="✅">Mandatory fields — per form</Strip>
      <div className="cols2">
        {MANDATE_GROUPS.map((g) => (
          <div key={g.section} className="card scard" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15 }}><span className="sicon">{g.icon}</span>{g.label}
              <span className="pill soft mini">{reqOf(g).length} mandatory</span></h3>
            <p className="muted mini" style={{ margin: '4px 0 0' }}>
              {g.note} Tap a chip to make that field mandatory (gold = mandatory) — enforced when saving, including imports.
            </p>
            <div className="chiprow">
              {g.fields.map(([key, label]) => (
                <button key={key} className={'togglechip' + (reqOf(g).includes(key) ? ' on' : '')}
                  onClick={() => toggleReq(g, key, label)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Strip icon="💰">Budgets</Strip>
      <div className="cols2">
        <div className="card scard" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}><span className="sicon">💰</span>Annual training budgets (₹, per entity)</h3>
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
      </div>

      <Strip icon="✉">Integrations</Strip>
      <div className="cols2">
        <div className="card scard" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}><span className="sicon">✉</span>E-mail notifications (Outlook / Microsoft 365)</h3>
          <p className="muted mini" style={{ margin: '4px 0 10px' }}>
            Automatic Outlook e-mails: nominees/assignees get the details with a sign-in link; opening
            self-nomination invites every eligible employee; after the nomination deadline managers and
            leaders get the consolidated participant list; when a training is marked completed they get
            the attendance status. Mails never block the action — failures are only logged.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={sm.enabled} onChange={(e) => setSmtp({ ...sm, enabled: e.target.checked })} />
            Send nomination / assignment e-mails
          </label>
          <div className="form-grid">
            <div><label>Connection method</label>
              <select value={sm.method || 'graph'} onChange={(e) => setSmtp({ ...sm, method: e.target.value })}>
                <option value="graph">Microsoft Graph API (recommended — no app password)</option>
                <option value="smtp">SMTP app password (only if your company allows it)</option>
              </select></div>
            <div><label>Send as (From mailbox)</label>
              <input value={sm.from} onChange={(e) => setSmtp({ ...sm, from: e.target.value, user: e.target.value })} placeholder="lokshni@avanasurgical.com" /></div>
            <div><label>Sender display name</label>
              <input value={sm.from_name || ''} onChange={(e) => setSmtp({ ...sm, from_name: e.target.value })} placeholder="Avana Academy" /></div>
            <div><label>Test e-mails go to</label>
              <input value={sm.notify} onChange={(e) => setSmtp({ ...sm, notify: e.target.value })} placeholder="lokshni@avanasurgical.com" /></div>
            {(sm.method || 'graph') === 'graph' ? (<>
              <div><label>Directory (tenant) ID</label>
                <input value={sm.tenant_id} onChange={(e) => setSmtp({ ...sm, tenant_id: e.target.value })} placeholder="xxxxxxxx-xxxx-…" /></div>
              <div><label>Application (client) ID</label>
                <input value={sm.client_id} onChange={(e) => setSmtp({ ...sm, client_id: e.target.value })} placeholder="xxxxxxxx-xxxx-…" /></div>
              <div><label>Client secret {settings.smtp?.has_secret ? '(saved — leave blank to keep)' : '(optional)'}</label>
                <input type="password" value={sm.client_secret} onChange={(e) => setSmtp({ ...sm, client_secret: e.target.value })}
                  placeholder={settings.smtp?.has_secret ? '••••••••' : 'leave blank to use the server certificate'} autoComplete="new-password" />
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  Server certificate: {settings.smtp?.cert_available
                    ? <b style={{ color: 'var(--good)' }}>ready ✓ — upload its public .cer in Entra → Certificates</b>
                    : 'not generated yet'}
                </div></div>
            </>) : (
              <div><label>App password {settings.smtp?.has_pass ? '(saved — leave blank to keep)' : '*'}</label>
                <input type="password" value={sm.pass} onChange={(e) => setSmtp({ ...sm, pass: e.target.value })}
                  placeholder={settings.smtp?.has_pass ? '••••••••' : 'paste the app password'} autoComplete="new-password" /></div>
            )}
          </div>
          <p className="muted mini" style={{ marginTop: 8 }}>
            {(sm.method || 'graph') === 'graph'
              ? 'The three values come from a one-time app registration at entra.microsoft.com (App registrations → New → copy tenant ID + client ID; Certificates or a client secret; API permissions → Microsoft Graph → Application → Mail.Send → Grant admin consent).'
              : 'Server: smtp.office365.com, port 587. Needs Authenticated SMTP enabled on the mailbox and an app password.'}
            {' '}Secrets are stored on your server only and never shown again.
          </p>
          <div className="form-actions">
            <button className="btn gold" onClick={saveSmtp}>Save e-mail settings</button>
            <button className="btn" disabled={testing} onClick={testMail}>{testing ? 'Sending…' : '✉ Send test e-mail'}</button>
          </div>
        </div>

        {(() => {
          const td = tplDraft || settings.email_templates || {};
          const set = (k, v) => setTplDraft({ ...td, [k]: v });
          const blocks = [
            { sKey: 'nominee_subject', bKey: 'nominee_body', title: 'Nomination / assignment mail (to the employee)',
              ph: '{name} {kind} {verb} {training} {code} {dates} {mode} {slot} {how}' },
            { sKey: 'announce_subject', bKey: 'announce_body', title: 'Nominations-open invitation (to eligible employees)',
              ph: '{name} {training} {code} {dates} {mode} {deadline} {link}' },
          ];
          return (
            <div className="card scard" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 15 }}><span className="sicon">📝</span>E-mail templates</h3>
              <p className="muted mini" style={{ margin: '4px 0 10px' }}>
                Edit the wording; the {'{placeholders}'} are filled in automatically per mail, and the logo,
                "Open the Learning Hub" button and footer are always added. A "Label: {'{value}'}" line whose
                value is empty is dropped from the mail.
              </p>
              {blocks.map((b) => (
                <div key={b.sKey} style={{ marginBottom: 14 }}>
                  <b style={{ fontSize: 13 }}>{b.title}</b>
                  <div className="muted" style={{ fontSize: 11, margin: '2px 0 6px' }}>Placeholders: {b.ph}</div>
                  <input style={{ width: '100%', marginBottom: 6 }} value={td[b.sKey] || ''}
                    placeholder="Subject" onChange={(e) => set(b.sKey, e.target.value)} />
                  <textarea rows={6} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
                    value={td[b.bKey] || ''} onChange={(e) => set(b.bKey, e.target.value)} />
                </div>
              ))}
              <div className="form-actions">
                <button className="btn gold" disabled={!tplDraft}
                  onClick={() => { save('email_templates', td, 'E-mail templates saved — used from the next mail onwards.'); setTplDraft(null); }}>
                  Save templates
                </button>
                {tplDraft && <button className="btn" onClick={() => setTplDraft(null)}>Discard changes</button>}
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}
