import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function QrModal({ title, url, desc, onClose }) {
  const [img, setImg] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { width: 230, margin: 1 }).then(setImg).catch(() => setImg(null));
  }, [url]);

  const copy = () => navigator.clipboard.writeText(url).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }).catch(() => {});

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, textAlign: 'center' }}>
        <h3>{title}</h3>
        {desc && <p className="muted mini" style={{ textAlign: 'left' }}>{desc}</p>}
        {img
          ? <img src={img} alt="QR code" style={{ background: '#fff', padding: 10, borderRadius: 10, border: '1px solid var(--line)' }} />
          : <p className="muted">Generating…</p>}
        <p className="muted" style={{ fontSize: 11, wordBreak: 'break-all', marginTop: 10 }}>{url}</p>
        <div className="form-actions" style={{ justifyContent: 'center' }}>
          <button className="btn gold" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
