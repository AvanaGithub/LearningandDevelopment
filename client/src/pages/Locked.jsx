import React from 'react';

export default function Locked({ title, note }) {
  return (
    <>
      <div className="page-head"><h2>{title}</h2></div>
      <div className="card">
        <span className="pill soft">Coming to this platform</span>
        <p className="muted" style={{ marginBottom: 0 }}>
          {note || `${title} is being moved from the prototype onto the new platform with real, shared data.`}{' '}
          Until then the clickable prototype remains the working reference.
        </p>
      </div>
    </>
  );
}
