import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_BASE = 'http://localhost:5000';

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function App() {
  const [files, setFiles] = useState([]);
  const [fileIndex, setFileIndex] = useState(0);
  const [peers, setPeers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/files`)
      .then((res) => res.json())
      .then((data) => setFiles(data.files));
  }, []);

  const currentFile = files[fileIndex];

  useEffect(() => {
    if (!currentFile) return;

    fetch(`${API_BASE}/api/tracker/${currentFile._id}/peers`)
      .then((res) => res.json())
      .then((data) => setPeers(data.peers));

    fetch(`${API_BASE}/api/tracker/${currentFile._id}/activity`)
      .then((res) => res.json())
      .then((data) => setLogs(data.logs));
  }, [currentFile]);

  useEffect(() => {
    const socket = io('http://localhost:5000');

    socket.on('swarm-update', (data) => {
      if (!currentFile) return;
      if (data.fileId === null || data.fileId === currentFile._id) {
        fetch(`${API_BASE}/api/tracker/${currentFile._id}/peers`)
          .then((res) => res.json())
          .then((peerData) => setPeers(peerData.peers));

        fetch(`${API_BASE}/api/tracker/${currentFile._id}/activity`)
          .then((res) => res.json())
          .then((logData) => setLogs(logData.logs));
      }
    });

    return () => socket.disconnect();
  }, [currentFile]);

  const togglePlayPause = () => {
    const endpoint = isPlaying ? 'pause' : 'resume';
    fetch(`${API_BASE}/api/simulate/${endpoint}`, { method: 'POST' });
    setIsPlaying(!isPlaying);
  };

  if (!currentFile) {
    return <div className="dashboard">Loading...</div>;
  }

  const seederCount = peers.filter((p) => p.bitfield.every(Boolean)).length;
  const leecherCount = peers.length - seederCount;
  const totalOwned = peers.reduce((sum, p) => sum + p.bitfield.filter(Boolean).length, 0);
  const totalSlots = peers.length * currentFile.pieceCount;
  const swarmPercent = totalSlots > 0 ? Math.round((totalOwned / totalSlots) * 100) : 0;

  return (
    <div className="dashboard">
      <h1 className="dashboard-title">Torrent Swarm Simulator</h1>

      <div className="top-row">
        <div className="file-switcher">
          <button disabled={fileIndex <= 0} onClick={() => setFileIndex(fileIndex - 1)}>
            {'<'}
          </button>
          <div className="file-info">
            <p>{currentFile.originalName}</p>
            <p>{fileIndex + 1} of {files.length}</p>
          </div>
          <button
            disabled={fileIndex >= files.length - 1}
            onClick={() => setFileIndex(fileIndex + 1)}
          >
            {'>'}
          </button>
        </div>

        <div className="stat-card">
          <p>Total peers</p>
          <p>{peers.length}</p>
        </div>
        <div className="stat-card">
          <p>Seeders</p>
          <p>{seederCount}</p>
        </div>
        <div className="stat-card">
          <p>Leechers</p>
          <p>{leecherCount}</p>
        </div>
        <div className="stat-card">
          <p>Swarm complete</p>
          <p>{swarmPercent}%</p>
        </div>
      </div>

      <div className="main-grid">
        <div className="peer-list">
          {peers.map((peer) => {
            const isSeeder = peer.bitfield.every(Boolean);
            const isIdle = peer.bitfield.every((has) => !has);
            const badgeClass = isSeeder
              ? 'badge-seeding'
              : isIdle
              ? 'badge-idle'
              : 'badge-downloading';
            const badgeLabel = isSeeder ? 'seeding' : isIdle ? 'idle' : 'downloading';

            return (
              <div className="peer-card" key={peer._id}>
                <div className="peer-card-header">
                  <span>{peer.peerLabel}</span>
                  <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
                </div>
                <div className="bitfield">
                  {peer.bitfield.map((has, index) => (
                    <div
                      key={index}
                      className={`bitfield-piece ${has ? 'piece-owned' : 'piece-missing'}`}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="activity-panel">
          <p>Piece activity</p>
          {logs.map((log) => (
            <div className="activity-row" key={log._id}>
              <span>
                {log.toPeerLabel} received piece {log.pieceIndex} from {log.fromPeerLabel}
              </span>
              <span className="activity-time">{timeAgo(log.timestamp)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="control-bar">
        <button className="play-pause-btn" onClick={togglePlayPause}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button className="control-btn-outline">+ Add peer</button>
        <button className="control-btn-outline">Piece frequency</button>
        <button className="control-btn-outline">⇧ Upload file</button>
      </div>
    </div>
  );
}

export default App;