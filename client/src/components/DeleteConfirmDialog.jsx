/* ============================================================
   DeleteConfirmDialog.jsx
   Confirmation modal shown before deleting a file.
   Displays the file name and peer count, then calls back
   to App.jsx to do the actual delete sequence.
   ============================================================ */
import React from 'react';

function DeleteConfirmDialog({ file, peerCount, onConfirm, onCancel }) {
  // Build the dialog message per spec:
  // - Omit "and its N peers" when peerCount is 0.
  const peersText = peerCount > 0 ? ` and its ${peerCount} peers` : '';

  return (
    <div className="modal-backdrop">
      <div className="modal-box">
        <h2>Delete file?</h2>
        <p style={{ lineHeight: 1.6 }}>
          Delete <strong>{file?.originalName}</strong>{peersText}? This also clears their transfer history.
        </p>
        <div className="modal-row" style={{ marginTop: 20 }}>
          <button className="btn-danger" onClick={onConfirm}>Delete</button>
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default DeleteConfirmDialog;
