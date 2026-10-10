/* ============================================================
   UploadDialog.jsx
   A small dialog with a file input. Sends the file as
   multipart/form-data with the field name EXACTLY "file"
   (any other name makes the server throw an error).
   On success: shows name + piece count, re-fetches the file
   list, and switches to the new file.
   ============================================================ */
import React, { useState, useRef } from 'react';

const API_BASE = 'http://localhost:5000';

function UploadDialog({ onClose, onUploaded }) {
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(null); // { name, pieceCount, fileId }
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    const file = inputRef.current?.files?.[0];
    if (!file) { setError('Please choose a file.'); return; }

    // Build multipart form — field name must be "file"
    const fd = new FormData();
    fd.append('file', file);

    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/files/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || data.message || 'Upload failed.');
      } else {
        setSuccess({ name: data.originalName, pieceCount: data.pieceCount, fileId: data.fileId });
        // Tell the parent to re-fetch /api/files and switch to this new file
        onUploaded(data.fileId);
      }
    } catch {
      setError('Network error — is the server running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box">
        <h2>Upload file</h2>
        <p className="modal-note">
          Files are split into 16 KB pieces, so a 10 MB file gives about 650 pieces.
        </p>
        <form onSubmit={handleSubmit} style={{ marginTop: 14 }}>
          <input type="file" ref={inputRef} />

          {error   && <div className="modal-error">{error}</div>}
          {success && (
            <div className="modal-success">
              Uploaded <strong>{success.name}</strong> — {success.pieceCount} pieces.
            </div>
          )}

          <div className="modal-row">
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Uploading…' : 'Upload'}
            </button>
            <button className="btn-ghost" type="button" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UploadDialog;
