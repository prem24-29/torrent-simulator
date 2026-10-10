/* ============================================================
   App.jsx  —  Root component / data hub

   This file owns all the data-fetching logic and top-level state.
   It passes data down to small, focused components that just
   display what they receive.

   DATA FLOW:
   1. On mount: fetch /api/files to get the file list.
   2. When the selected file changes: start a 2-second poll on
      GET /api/live/:fileId. A Socket.IO event 'swarm-update'
      can also trigger a re-fetch (at most once/second per file).
   3. To avoid races we use a "request ID" (a counter). If a
      response arrives after the file has changed, we discard it.
   4. Activity feed (/api/tracker/:fileId/activity) is fetched
      on each successful live response.
   5. DELETE sequence: pause → DELETE /api/files/:fileId →
      resume if it was running → move to next file.
   ============================================================ */
import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import './styles.css';

import Header            from './components/Header.jsx';
import StatCards         from './components/StatCards.jsx';
import TunnelsPanel      from './components/TunnelsPanel.jsx';
import PeerGrid          from './components/PeerGrid.jsx';
import DetailView        from './components/DetailView.jsx';
import ActivityFeed      from './components/ActivityFeed.jsx';
import SettingsPanel     from './components/SettingsPanel.jsx';
import UploadDialog      from './components/UploadDialog.jsx';
import BuildSwarmDialog  from './components/BuildSwarmDialog.jsx';
import AddPeerDialog     from './components/AddPeerDialog.jsx';
import DeleteConfirmDialog from './components/DeleteConfirmDialog.jsx';

const API_BASE = 'http://localhost:5000';

function App() {
  // --- File list ---
  const [files,     setFiles]     = useState([]);
  const [fileIndex, setFileIndex] = useState(0);

  // --- Live data from /api/live/:fileId ---
  const [liveData,  setLiveData]  = useState(null);  // the full JSON response
  const [logs,      setLogs]      = useState([]);     // from /api/tracker/:fileId/activity

  // --- Detail view ---
  // selectedPeerId is the id of the clicked peer. null = no selection.
  const [selectedPeerId, setSelectedPeerId] = useState(null);

  // --- Dialogs / panels ---
  const [showSettings,    setShowSettings]    = useState(false);
  const [showUpload,      setShowUpload]      = useState(false);
  const [showBuildSwarm,  setShowBuildSwarm]  = useState(false);
  const [showAddPeer,     setShowAddPeer]     = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // --- Race-guard: we tag every fetch with an id.
  //     If the file switches while a fetch is in-flight, we ignore the old response.
  const fetchIdRef = useRef(0);

  // --- Debounce socket events so we don't double-fetch with the poll ---
  const socketFetchInFlightRef = useRef(false);

  // Derived: the currently selected file object
  const currentFile = files[fileIndex] ?? null;

  // ─── Fetch the file list ──────────────────────────────────────────────────
  const fetchFiles = useCallback(async () => {
    const res  = await fetch(`${API_BASE}/api/files`);
    const data = await res.json();
    setFiles(data.files ?? []);
    return data.files ?? [];
  }, []);

  // Initial file list fetch
  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // ─── Fetch live data for the current file ─────────────────────────────────
  // Returns true if the data was applied (response matched the current file).
  const fetchLive = useCallback(async (fileId, myFetchId) => {
    try {
      const res = await fetch(`${API_BASE}/api/live/${fileId}`);

      // If the user switched files while this was in flight, discard the response.
      if (fetchIdRef.current !== myFetchId) return;

      if (res.status === 404) {
        // File was deleted externally — refresh file list and move away
        const newFiles = await fetchFiles();
        setFileIndex(idx => Math.min(idx, Math.max(newFiles.length - 1, 0)));
        setLiveData(null);
        return;
      }

      const data = await res.json();
      setLiveData(data);

      // Also fetch activity feed on every live update
      const actRes  = await fetch(`${API_BASE}/api/tracker/${fileId}/activity`);
      const actData = await actRes.json();
      if (fetchIdRef.current === myFetchId) {
        setLogs(actData.logs ?? []);
      }
    } catch {
      // Network error — silently skip; next poll will retry
    }
  }, [fetchFiles]);

  // ─── Polling every 2 seconds + socket trigger ────────────────────────────
  useEffect(() => {
    if (!currentFile) return;

    const fileId = currentFile._id;

    // Bump the fetch ID so any in-flight fetch from the old file is ignored
    fetchIdRef.current += 1;
    const myId = fetchIdRef.current;

    // Fetch immediately when file changes
    fetchLive(fileId, myId);

    // Then poll every 2 seconds
    const timer = setInterval(() => {
      fetchIdRef.current += 1;
      fetchLive(fileId, fetchIdRef.current);
    }, 2000);

    // Connect Socket.IO — re-fetch when the server fires 'swarm-update'
    const socket = io(API_BASE);
    socket.on('swarm-update', (payload) => {
      if (payload.fileId !== fileId) return;
      // Guard against double-fetching if a poll is about to fire anyway
      if (socketFetchInFlightRef.current) return;
      socketFetchInFlightRef.current = true;
      fetchIdRef.current += 1;
      fetchLive(fileId, fetchIdRef.current).finally(() => {
        socketFetchInFlightRef.current = false;
      });
    });

    return () => {
      clearInterval(timer);
      socket.disconnect();
    };
  }, [currentFile, fetchLive]);

  // ─── Auto-leave detail view if selected peer disappears ───────────────────
  useEffect(() => {
    if (!selectedPeerId || !liveData) return;
    const stillThere = liveData.peers.some(p => p.id === selectedPeerId);
    if (!stillThere) setSelectedPeerId(null);
  }, [liveData, selectedPeerId]);

  // ─── Play / Pause ─────────────────────────────────────────────────────────
  async function handleTogglePlay() {
    const running  = liveData?.running ?? false;
    const endpoint = running ? 'pause' : 'resume';
    await fetch(`${API_BASE}/api/simulate/${endpoint}`, { method: 'POST' });
    // Trigger an immediate re-fetch so the button icon updates quickly
    fetchIdRef.current += 1;
    fetchLive(currentFile._id, fetchIdRef.current);
  }

  // ─── Delete file sequence ─────────────────────────────────────────────────
  async function handleDeleteConfirm() {
    if (!currentFile) return;
    setShowDeleteConfirm(false);

    const wasRunning = liveData?.running ?? false;

    // 1. Pause
    if (wasRunning) {
      await fetch(`${API_BASE}/api/simulate/pause`, { method: 'POST' });
    }

    // 2. Delete the file
    await fetch(`${API_BASE}/api/files/${currentFile._id}`, { method: 'DELETE' });

    // 3. Resume only if it was running before
    if (wasRunning) {
      await fetch(`${API_BASE}/api/simulate/resume`, { method: 'POST' });
    }

    // 4. Refresh file list and move to the next file (or previous if at end)
    const newFiles = await fetchFiles();
    setFileIndex(idx => Math.min(idx, Math.max(newFiles.length - 1, 0)));
    setLiveData(null);
    setSelectedPeerId(null);
  }

  // ─── Upload success: re-fetch files and jump to the new file ─────────────
  async function handleUploaded(newFileId) {
    const newFiles = await fetchFiles();
    const idx = newFiles.findIndex(f => f._id === newFileId);
    if (idx !== -1) setFileIndex(idx);
    setShowUpload(false);
  }

  // ─── Build swarm success ──────────────────────────────────────────────────
  function handleBuilt() {
    // Force a live re-fetch
    if (currentFile) {
      fetchIdRef.current += 1;
      fetchLive(currentFile._id, fetchIdRef.current);
    }
  }

  // ─── Derived values ───────────────────────────────────────────────────────
  const peers      = liveData?.peers      ?? [];
  const transfers  = liveData?.transfers  ?? [];
  const tunnels    = liveData?.tunnels    ?? [];
  const summary    = liveData?.summary    ?? null;
  const running    = liveData?.running    ?? false;

  // The full selected peer object (always from the latest live response)
  const selectedPeer = peers.find(p => p.id === selectedPeerId) ?? null;

  // Peer count for the delete dialog
  const peerCount = summary?.totalPeers ?? 0;

  // ─── No files yet state ───────────────────────────────────────────────────
  if (files.length === 0) {
    return (
      <div className="page">
        <Header
          files={[]}
          fileIndex={0}
          onPrev={() => {}}
          onNext={() => {}}
          running={false}
          onTogglePlay={() => {}}
          onDelete={() => {}}
          onSettings={() => setShowSettings(true)}
          onUpload={() => setShowUpload(true)}
          onBuildSwarm={() => {}}
          onAddPeer={() => {}}
        />
        <div className="empty-state">
          <h2>No files yet — upload one to get started.</h2>
        </div>

        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        {showUpload   && (
          <UploadDialog
            onClose={() => setShowUpload(false)}
            onUploaded={handleUploaded}
          />
        )}
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="page">
      {/* 1. Header */}
      <Header
        files={files}
        fileIndex={fileIndex}
        onPrev={() => { setFileIndex(i => i - 1); setSelectedPeerId(null); }}
        onNext={() => { setFileIndex(i => i + 1); setSelectedPeerId(null); }}
        running={running}
        onTogglePlay={handleTogglePlay}
        onDelete={() => setShowDeleteConfirm(true)}
        onSettings={() => setShowSettings(true)}
        onUpload={() => setShowUpload(true)}
        onBuildSwarm={() => setShowBuildSwarm(true)}
        onAddPeer={() => setShowAddPeer(true)}
      />

      {/* 2. Stat cards */}
      <StatCards summary={summary} />

      {/* 3. Tunnels */}
      <TunnelsPanel tunnels={tunnels} />

      {/* 4 / 5. Peer grid OR detail view */}
      {selectedPeer ? (
        <DetailView
          selectedPeer={selectedPeer}
          allPeers={peers}
          transfers={transfers}
          fileId={currentFile._id}
          onBack={() => setSelectedPeerId(null)}
        />
      ) : (
        <PeerGrid
          peers={peers}
          selectedPeerId={null}
          onSelectPeer={id => setSelectedPeerId(id)}
        />
      )}

      {/* 6. Activity feed */}
      <ActivityFeed logs={logs} />

      {/* ── Dialogs / modals ─────────────────────────────────── */}

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {showUpload && (
        <UploadDialog
          onClose={() => setShowUpload(false)}
          onUploaded={handleUploaded}
        />
      )}

      {showBuildSwarm && (
        <BuildSwarmDialog
          fileId={currentFile._id}
          wasRunning={running}
          onClose={() => setShowBuildSwarm(false)}
          onBuilt={handleBuilt}
        />
      )}

      {showAddPeer && (
        <AddPeerDialog
          fileId={currentFile._id}
          onClose={() => setShowAddPeer(false)}
        />
      )}

      {showDeleteConfirm && (
        <DeleteConfirmDialog
          file={currentFile}
          peerCount={peerCount}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

export default App;