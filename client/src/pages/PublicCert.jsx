import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fmtDate } from '../api.js';

// Scan-to-verify page reached from the QR printed on every certificate.
export default function PublicCert() {
  const { certNo } = useParams();
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch('/api/public/cert/' + encodeURIComponent(certNo))
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error)))))
      .then(setC)
      .catch((e) => setErr(e.message));
  }, [certNo]);

  const dates = c && (c.first_day
    ? (c.first_day === c.last_day ? fmtDate(c.first_day) : `${fmtDate(c.first_day)} – ${fmtDate(c.last_day)}`)
    : null);

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'center', maxWidth: 440 }}>
        <h1 style={{ fontSize: 18 }}>Avana Academy</h1>
        <p className="login-sub">Certificate verification</p>
        {!c && !err && <p className="muted">Checking…</p>}
        {err && (
          <>
            <div style={{ fontSize: 52, color: 'var(--crit, #c62828)' }}>✕</div>
            <h2 style={{ fontSize: 17, margin: '8px 0 2px' }}>Not a valid certificate</h2>
            <p className="muted mini">No certificate with the number <b>{certNo}</b> was issued by Avana Academy.</p>
          </>
        )}
        {c && (
          <>
            <div style={{ fontSize: 52, color: 'var(--good, #1a7f37)' }}>✓</div>
            <h2 style={{ fontSize: 17, margin: '8px 0 2px' }}>Valid certificate</h2>
            <p style={{ fontSize: 15, margin: '10px 0 2px' }}><b>{c.employee}</b></p>
            {c.description && <p className="muted" style={{ fontSize: 13, margin: '2px 0' }}>{c.description}</p>}
            <p style={{ fontSize: 14, margin: '2px 0' }}>{c.training}</p>
            <p className="muted mini">
              {[dates, c.location].filter(Boolean).join(' · ')}
            </p>
            <p className="muted mini" style={{ marginTop: 10 }}>
              Certificate no: <b>{c.cert_no}</b><br />
              Issued {new Date(c.issued_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} ·
              Avana Academy, Learning &amp; Development
            </p>
          </>
        )}
      </div>
    </div>
  );
}
