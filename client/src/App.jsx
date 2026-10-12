/* ============================================================
   App.jsx  —  Root component / data hub

   This file owns all the data-fetching logic and top-level state.
   It passes data down to small, focused components.

   DATA FLOW:
   1. On mount: fetch /api/files AND /api/explain.
      If any explain type is armed, turn on Explanation mode.
   2. When the selected file changes: start a 2-second poll on
      GET /api/live/:fileId. A Socket.IO 'swarm-update' event also
      triggers a re-fetch. Each live fetch also fetches /api/explain
      so the picker strip and paused panel stay current.
   3. Race guard: fetchIdRef tags every in-flight fetch. If the file
      switches mid-flight, stale responses are discarded.
   4. Explanation mode:
      - explainData holds { types, paused } from the latest /api/explain.
      - explainMode (boolean) shows/hides the picker strip.
      - selectedExplainEvent drives which peers are outlined in the grid.
      - When paused becomes non-null, the detail view is closed so all
        tiles are visible.
      - When the selected explain event belongs to a different file, we
        switch the file switcher to that file.
   5. Part A: layout order is Header → picker strip → stat cards → grid →
      tunnels panel → activity feed. Tunnels moved below the grid.
   ============================================================ */
import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import './styles.css';

import Header              from './components/Header.jsx';
import StatCards           from './components/StatCards.jsx';
import TunnelsPanel        from './components/TunnelsPanel.jsx';
import PeerGrid            from './components/PeerGrid.jsx';
import DetailView          from './components/DetailView.jsx';
import ActivityFeed        from './components/ActivityFeed.jsx';
import SettingsPanel       from './components/SettingsPanel.jsx';
import UploadDialog        from './components/UploadDialog.jsx';
import BuildSwarmDialog    from './components/BuildSwarmDialog.jsx';
import AddPeerDialog       from './components/AddPeerDialog.jsx';
import DeleteConfirmDialog from './components/DeleteConfirmDialog.jsx';
import ExplainPickerStrip  from './components/ExplainPickerStrip.jsx';
import ExplainPausedPanel  from './components/ExplainPausedPanel.jsx';
import { API_BASE }        from './apiConfig.js';

function App() {
  // --- File list ---
  const [files,     setFiles]     = useState([]);
  const [fileIndex, setFileIndex] = useState(0);

  // --- Live data from /api/live/:fileId ---
  const [liveData,  setLiveData]  = useState(null);
  const [logs,      setLogs]      = useState([]);

  // --- Detail view ---
  const [selectedPeerId, setSelectedPeerId] = useState(null);

  // --- Explanation mode ---
  // explainData: { types: { ... }, paused: null | { headline, events } }
  const [explainData,          setExplainData]          = useState(null);
  const [explainMode,          setExplainMode]          = useState(false);
  // The event object the user has selected in the paused panel (drives highlights)
  const [selectedExplainEvent, setSelectedExplainEvent] = useState(null);
  // Race guard for /api/explain fetches — same pattern as fetchIdRef
  const explainFetchIdRef = useRef(0);

  // --- Dialogs / panels ---
  const [showSettings,      setShowSettings]      = useState(false);
  const [showUpload,        setShowUpload]        = useState(false);
  const [showBuildSwarm,    setShowBuildSwarm]    = useState(false);
  const [showAddPeer,       setShowAddPeer]       = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Race guard: every fetch is tagged with this counter; stale responses are discarded.
  const fetchIdRef = useRef(0);

  // Debounce socket events so we don't double-fetch with the poll
  const socketFetchInFlightRef = useRef(false);

  // Derived: the currently selected file object
  const currentFile = files[fileIndex] ?? null;

  // ─── Fetch explain state ──────────────────────────────────────────────────
  // myExplainId lets us discard out-of-order responses.
  const fetchExplain = useCallback(async (myExplainId) => {
    try {
      const res  = await fetch(`${API_BASE}/api/explain`);
      if (explainFetchIdRef.current !== myExplainId) return; // stale
      if (!res.ok) return;
      const data = await res.json();
      if (explainFetchIdRef.current !== myExplainId) return; // stale
      setExplainData(data);
      return data;
    } catch {
      // Network error — silently skip
    }
  }, []);

  // ─── Fetch the file list ──────────────────────────────────────────────────
  const fetchFiles = useCallback(async () => {
    const res  = await fetch(`${API_BASE}/api/files`);
    const data = await res.json();
    setFiles(data.files ?? []);
    return data.files ?? [];
  }, []);

  // Initial fetches: file list + explain state
  useEffect(() => {
    fetchFiles();
    explainFetchIdRef.current += 1;
    fetchExplain(explainFetchIdRef.current).then(data => {
      // Auto-enable Explanation mode if any type is armed on the server
      if (data && Object.values(data.types || {}).some(t => t.armed)) {
        setExplainMode(true);
      }
    });
  }, [fetchFiles, fetchExplain]);

  // ─── Fetch live data for the current file ─────────────────────────────────
  const fetchLive = useCallback(async (fileId, myFetchId) => {
    try {
      const res = await fetch(`${API_BASE}/api/live/${fileId}`);

      // Discard if the file changed while we were waiting
      if (fetchIdRef.current !== myFetchId) return;

      if (res.status === 404) {
        // File deleted externally — refresh file list and move away
        const newFiles = await fetchFiles();
        setFileIndex(idx => Math.min(idx, Math.max(newFiles.length - 1, 0)));
        setLiveData(null);
        return;
      }

      const data = await res.json();
      setLiveData(data);

      // Activity feed — fetched alongside every live update
      const actRes  = await fetch(`${API_BASE}/api/tracker/${fileId}/activity`);
      const actData = await actRes.json();
      if (fetchIdRef.current === myFetchId) {
        setLogs(actData.logs ?? []);
      }

      // Also refresh explain state on every live cycle so the picker strip
      // and paused panel stay current without a separate timer.
      explainFetchIdRef.current += 1;
      fetchExplain(explainFetchIdRef.current);

    } catch {
      // Network error — silently skip; next poll will retry
    }
  }, [fetchFiles, fetchExplain]);

  // ─── Polling every 2 seconds + socket trigger ────────────────────────────
  useEffect(() => {
    if (!currentFile) return;

    const fileId = currentFile._id;

    // Bump the fetch ID so in-flight fetches from the old file are discarded
    fetchIdRef.current += 1;
    const myId = fetchIdRef.current;

    // Immediate fetch when file changes
    fetchLive(fileId, myId);

    // Poll every 2 seconds
    const timer = setInterval(() => {
      fetchIdRef.current += 1;
      fetchLive(fileId, fetchIdRef.current);
    }, 2000);

    // Socket.IO — re-fetch when the server fires 'swarm-update'
    const socket = API_BASE ? io(API_BASE) : io();
    socket.on('swarm-update', (payload) => {
      if (payload.fileId !== fileId) return;
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

  // ─── When a pause arrives, leave isolation so all tiles are visible ───────
  useEffect(() => {
    if (explainData?.paused) {
      setSelectedPeerId(null);
    }
  }, [explainData?.paused]);

  // ─── Default the selected explain event to the headline whenever paused changes ──
  useEffect(() => {
    if (explainData?.paused) {
      setSelectedExplainEvent(explainData.paused.headline);
    } else {
      setSelectedExplainEvent(null);
    }
  }, [explainData?.paused]);

  // ─── Switch file if the selected explain event belongs to a different file ─
  useEffect(() => {
    if (!selectedExplainEvent || files.length === 0) return;
    const eventFileId = selectedExplainEvent.fileId;
    const idx = files.findIndex(f => f._id === eventFileId);
    if (idx !== -1 && idx !== fileIndex) {
      setFileIndex(idx);
    }
  }, [selectedExplainEvent, files, fileIndex]);

  // ─── Play / Pause ─────────────────────────────────────────────────────────
  async function handleTogglePlay() {
    const running  = liveData?.running ?? false;
    const endpoint = running ? 'pause' : 'resume';
    await fetch(`${API_BASE}/api/simulate/${endpoint}`, { method: 'POST' });
    // Immediate re-fetch so the button icon updates quickly
    fetchIdRef.current += 1;
    fetchLive(currentFile._id, fetchIdRef.current);
    // Also refresh explain state — pressing play clears a pause on the server
    explainFetchIdRef.current += 1;
    fetchExplain(explainFetchIdRef.current);
  }

  // ─── Explanation mode toggle ───────────────────────────────────────────────
  async function handleToggleExplain() {
    if (!explainMode) {
      // Turning ON: just show the picker strip
      setExplainMode(true);
    } else {
      // Turning OFF:
      // 1. Disarm all types so nothing hidden can still pause the swarm
      await fetch(`${API_BASE}/api/explain/arm-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ armed: false }),
      });
      // 2. If the sim is currently paused by an explanation, continue it
      if (explainData?.paused) {
        await fetch(`${API_BASE}/api/explain/continue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
      }
      // 3. Refresh explain state, then hide the mode
      explainFetchIdRef.current += 1;
      await fetchExplain(explainFetchIdRef.current);
      setExplainMode(false);
    }
  }

  // ─── ExplainPickerStrip: server returned new types after a POST ───────────
  // Replace only the types part of explainData; paused stays as-is.
  function handleExplainTypesUpdate(newTypes) {
    setExplainData(prev => prev ? { ...prev, types: newTypes } : { types: newTypes, paused: null });
  }

  // ─── ExplainPausedPanel: user clicked Continue ────────────────────────────
  // The response from /api/explain/continue includes the full explain state.
  function handleExplainContinue(responseData) {
    setExplainData(responseData);
    // Also trigger a live refresh so the grid updates without waiting for the poll
    if (currentFile) {
      fetchIdRef.current += 1;
      fetchLive(currentFile._id, fetchIdRef.current);
    }
  }

  // ─── Delete file sequence ─────────────────────────────────────────────────
  async function handleDeleteConfirm() {
    if (!currentFile) return;
    setShowDeleteConfirm(false);

    const wasRunning = liveData?.running ?? false;

    if (wasRunning) {
      await fetch(`${API_BASE}/api/simulate/pause`, { method: 'POST' });
    }
    await fetch(`${API_BASE}/api/files/${currentFile._id}`, { method: 'DELETE' });
    if (wasRunning) {
      await fetch(`${API_BASE}/api/simulate/resume`, { method: 'POST' });
    }

    const newFiles = await fetchFiles();
    setFileIndex(idx => Math.min(idx, Math.max(newFiles.length - 1, 0)));
    setLiveData(null);
    setSelectedPeerId(null);
  }

  // ─── Upload success ────────────────────────────────────────────────────────
  async function handleUploaded(newFileId) {
    const newFiles = await fetchFiles();
    const idx = newFiles.findIndex(f => f._id === newFileId);
    if (idx !== -1) setFileIndex(idx);
    setShowUpload(false);
  }

  // ─── Build swarm success ──────────────────────────────────────────────────
  function handleBuilt() {
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

  const selectedPeer = peers.find(p => p.id === selectedPeerId) ?? null;
  const peerCount    = summary?.totalPeers ?? 0;

  // Set of peer labels to outline in the grid (from the selected explain event)
  const explainHighlightLabels = new Set(
    selectedExplainEvent?.peers ?? []
  );

  // When the paused panel is visible, add bottom padding so content isn't hidden
  const isPaused = !!(explainData?.paused);

  // ─── No files yet ─────────────────────────────────────────────────────────
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
          explainMode={explainMode}
          onToggleExplain={handleToggleExplain}
        />
        {explainMode && explainData && (
          <ExplainPickerStrip
            types={explainData.types}
            onTypesUpdate={handleExplainTypesUpdate}
          />
        )}
        <div className="empty-state">
          <h2>No files yet — upload one to get started.</h2>
        </div>
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        {showUpload   && (
          <UploadDialog onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />
        )}
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    // Extra bottom padding when the fixed paused panel is visible so the
    // activity feed is not hidden behind it (35vh + a little margin).
    <div className="page" style={isPaused ? { paddingBottom: 'calc(35vh + 24px)' } : {}}>

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
        explainMode={explainMode}
        onToggleExplain={handleToggleExplain}
      />

      {/* 2. Picker strip (visible when Explanation mode is ON) */}
      {explainMode && explainData && (
        <ExplainPickerStrip
          types={explainData.types}
          onTypesUpdate={handleExplainTypesUpdate}
        />
      )}

      {/* 3. Stat cards */}
      <StatCards summary={summary} />

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
          explainHighlightLabels={explainHighlightLabels}
        />
      )}

      {/* 6. Tunnels panel — now BELOW the grid, ABOVE the activity feed */}
      <TunnelsPanel tunnels={tunnels} />

      {/* 7. Activity feed */}
      <ActivityFeed logs={logs} />

      {/* ── Fixed paused panel (always last in DOM; position:fixed) ─── */}
      <ExplainPausedPanel
        paused={explainData?.paused ?? null}
        types={explainData?.types ?? {}}
        selectedEventId={selectedExplainEvent?.id ?? null}
        onSelectEvent={setSelectedExplainEvent}
        onContinue={handleExplainContinue}
      />

      {/* ── Dialogs / modals ─────────────────────────────────────────── */}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
      {showUpload && (
        <UploadDialog onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />
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
        <AddPeerDialog fileId={currentFile._id} onClose={() => setShowAddPeer(false)} />
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