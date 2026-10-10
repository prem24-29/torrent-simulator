/* ============================================================
   Header.jsx
   Top bar containing:
   - App title
   - File switcher (prev/next, "X of Y", file name, upload time)
   - Delete-file button → triggers confirmation dialog in App.jsx
   - Play/pause toggle (reads running state from live response)
   - Settings, Upload file, Build swarm, Add peer buttons

   All heavy action logic (delete sequence, dialog open/close)
   lives in App.jsx; this component just renders the UI and
   fires the callback props.
   ============================================================ */
import React from 'react';

// Format an ISO date as a short readable string, e.g. "8 Oct 05:00"
function formatUploadTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const day  = d.getDate();
  const mon  = d.toLocaleString('default', { month: 'short' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day} ${mon} ${time}`;
}

function Header({
  files,          // array of all file objects
  fileIndex,      // current index into files
  onPrev,         // go to previous file
  onNext,         // go to next file
  running,        // boolean — is the simulation running?
  onTogglePlay,   // toggle play/pause
  onDelete,       // open delete confirmation
  onSettings,     // open settings panel
  onUpload,       // open upload dialog
  onBuildSwarm,   // open build-swarm dialog
  onAddPeer,      // open add-peer dialog
}) {
  const currentFile = files[fileIndex];

  return (
    <header className="header">
      <h1>Swarm Simulator</h1>

      {/* File switcher */}
      {currentFile && (
        <div className="file-switcher">
          <button
            className="file-switcher-nav"
            onClick={onPrev}
            disabled={fileIndex <= 0}
            title="Previous file"
          >
            ‹
          </button>

          <div className="file-switcher-info">
            <span className="file-switcher-name" title={currentFile.originalName}>
              {currentFile.originalName}
            </span>
            <span className="file-switcher-meta">
              {fileIndex + 1} of {files.length} · {formatUploadTime(currentFile.uploadedAt)}
            </span>
          </div>

          <button
            className="file-switcher-nav"
            onClick={onNext}
            disabled={fileIndex >= files.length - 1}
            title="Next file"
          >
            ›
          </button>
        </div>
      )}

      {/* Delete button — only show when there is a file */}
      {currentFile && (
        <button className="header-btn danger" onClick={onDelete} title="Delete this file">
          🗑 Delete
        </button>
      )}

      {/* Spacer pushes play/pause + actions to the right */}
      <div className="header-spacer" />

      {/* Play / Pause (circular) */}
      {currentFile && (
        <button
          className={`play-pause-btn${running ? '' : ' paused'}`}
          onClick={onTogglePlay}
          title={running ? 'Pause simulation' : 'Resume simulation'}
        >
          {running ? '⏸' : '▶'}
        </button>
      )}

      <button className="header-btn" onClick={onSettings}>⚙ Settings</button>
      <button className="header-btn" onClick={onUpload}>⇧ Upload file</button>
      {currentFile && (
        <>
          <button className="header-btn" onClick={onBuildSwarm}>🔧 Build swarm</button>
          <button className="header-btn" onClick={onAddPeer}>+ Add peer</button>
        </>
      )}
    </header>
  );
}

export default Header;
