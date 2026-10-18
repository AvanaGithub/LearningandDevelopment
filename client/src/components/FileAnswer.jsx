import React, { useState } from 'react';

// Attachment answer for feedback questions / report submissions: picks
// files, uploads via the given function, keeps [{id, name}] chips.
export default function FileAnswer({ value, onChange, uploadTo, accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png' }) {
  const [busy, setBusy] = useState(false);
  const files = Array.isArray(value) ? value : [];
  const pick = async (e) => {
    if (!e.target.files.length) return;
    setBusy(true);
    try {
      const out = await uploadTo(e.target.files);
      onChange([...files, ...out].slice(0, 5));
    } catch (err) {
      if (!err.need_login) alert(err.message);
      else throw err;
    }
    setBusy(false);
    e.target.value = '';
  };
  return (
    <div>
      <label className="btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
        {busy ? 'Uploading…' : '📎 Upload file(s)'}
        <input type="file" multiple hidden accept={accept} disabled={busy} onChange={pick} />
      </label>
      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {files.map((f, i) => (
            <span key={f.id} className="pill soft mini">📄 {f.name}
              <button type="button" className="btn link" style={{ padding: '0 3px' }}
                onClick={() => onChange(files.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
