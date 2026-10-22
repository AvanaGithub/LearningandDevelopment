import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// Scan-to-verify page reached from the QR printed on every certificate:
// whose certificate it is, for which training, when and where.
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

  const Row = ({ label, value, strong }) => (
    <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line, #e7dfcf)', textAlign: 'left' }}>
      <span className="muted" style={{ width: 120, flexShrink: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', paddingTop: 2 }}>{label}</span>
      <span style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? 700 : 400, overflowWrap: 'anywhere' }}>
        {value || <span className="muted" style={{ fontStyle: 'italic' }}>Not recorded</span>}
      </span>
    </div>
  );

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'center', maxWidth: 460 }}>
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
            <div style={{ fontSize: 48, lineHeight: 1, color: 'var(--good, #1a7f37)' }}>✓</div>
            <h2 style={{ fontSize: 17, margin: '8px 0 14px', color: 'var(--good, #1a7f37)' }}>Valid certificate</h2>
            <Row label="Awarded to" value={c.employee} strong />
            <Row label="Training" value={c.training} />
            <Row label="Training dates" value={c.dates && `${c.dates}${c.day_count > 1 ? ` (${c.day_count} days)` : ''}`} />
            <Row label="Location" value={c.location} />
            {c.description && <Row label="Recognised for" value={c.description} />}
            <Row label="Certificate no." value={c.cert_no} />
            <Row label="Issued on" value={c.issued_on} />
            <p className="muted mini" style={{ marginTop: 12 }}>
              Issued by Avana Academy · Learning &amp; Development, Avana Group
            </p>
          </>
        )}
      </div>
    </div>
  );
}
