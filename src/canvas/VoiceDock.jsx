import { useState, useRef, useEffect, useCallback } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import './VoiceDock.css';

const API = 'http://localhost:3001';
const PERSONAS = ['engineer', 'grandpa', 'mayordomo'];

export default function VoiceDock() {
  const [status, setStatus] = useState('off'); // off|booting|connecting|live|error|offline
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState([]);
  const [persona, setPersona] = useState('engineer');
  const [openMic, setOpenMic] = useState(false);
  const [card, setCard] = useState(null);
  const [err, setErr] = useState('');

  const roomRef = useRef(null);
  const agentRef = useRef(null);
  const pttRef = useRef(null);
  const liveTimerRef = useRef(null);
  const openMicRef = useRef(false);
  const audioElsRef = useRef([]);
  const pendingApprovalRef = useRef(null);
  const transcriptRef = useRef(null);

  useEffect(() => { openMicRef.current = openMic; }, [openMic]);

  // auto-scroll transcript to the latest line
  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [lines]);

  const addLine = useCallback((who, text) => {
    setLines((prev) => [...prev.slice(-100), { who, text }]);
  }, []);

  const setMic = useCallback((live) => {
    if (roomRef.current) roomRef.current.localParticipant.setMicrophoneEnabled(live);
  }, []);

  const teardown = useCallback(() => {
    if (liveTimerRef.current) { clearTimeout(liveTimerRef.current); liveTimerRef.current = null; }
    if (pttRef.current) { pttRef.current.close(); pttRef.current = null; }
    const r = roomRef.current;
    roomRef.current = null; // null first so the Disconnected handler ignores our own teardown
    if (r) { try { r.disconnect(); } catch { /* noop */ } }
    audioElsRef.current.forEach((el) => { try { el.srcObject = null; el.remove(); } catch { /* noop */ } });
    audioElsRef.current = [];
    if (pendingApprovalRef.current) { pendingApprovalRef.current('reject'); pendingApprovalRef.current = null; }
    agentRef.current = null;
    setCard(null);
  }, []);

  const turnOff = useCallback(() => {
    teardown();
    setStatus('off');
    fetch(`${API}/api/voice/stop`, { method: 'POST' }).catch(() => {});
  }, [teardown]);

  const turnOn = useCallback(async () => {
    setErr('');
    setStatus('booting');
    try {
      const s = await fetch(`${API}/api/voice/start`, { method: 'POST' });
      if (!s.ok) throw new Error('worker failed to start');

      setStatus('connecting');
      const tr = await fetch(`${API}/api/livekit/token`);
      if (!tr.ok) throw new Error('token fetch failed');
      const { url, token } = await tr.json();

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach(); el.autoplay = true;
          document.body.appendChild(el);
          audioElsRef.current.push(el);
        }
      });
      room.on(RoomEvent.ParticipantConnected, (p) => {
        if (p.identity !== 'operator') { agentRef.current = p.identity; setStatus('live'); }
      });
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        const who = participant?.identity === 'operator' ? 'You' : 'Mayordomo';
        for (const seg of segments) if (seg.final) addLine(who, seg.text);
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!roomRef.current) return; // we initiated teardown — ignore
        if (pttRef.current) { pttRef.current.close(); pttRef.current = null; }
        if (liveTimerRef.current) { clearTimeout(liveTimerRef.current); liveTimerRef.current = null; }
        roomRef.current = null;
        setStatus('offline');
      });

      await room.connect(url, token);

      room.localParticipant.registerRpcMethod('request_approval', (data) => {
        const proposal = JSON.parse(data.payload);
        setExpanded(true); // auto-expand so the card is never hidden
        return new Promise((resolve) => {
          pendingApprovalRef.current = resolve;
          setCard(proposal);
        });
      });

      for (const p of room.remoteParticipants.values()) {
        if (p.identity !== 'operator') { agentRef.current = p.identity; setStatus('live'); }
      }

      const es = new EventSource(`${API}/api/ptt/stream`);
      es.onmessage = (e) => { if (!openMicRef.current) setMic(e.data === 'down'); };
      pttRef.current = es;
      setMic(openMicRef.current);

      liveTimerRef.current = setTimeout(() => {
        if (!agentRef.current) {
          setStatus('error');
          fetch(`${API}/api/voice/status`).then((r) => r.json())
            .then((st) => setErr(st.recentLog?.slice(-1)[0] || 'worker not detected'))
            .catch(() => setErr('worker not detected'));
        }
      }, 10000);
    } catch (e) {
      setErr(e.message);
      setStatus('error');
      teardown();
    }
  }, [addLine, setMic, teardown]);

  const toggle = useCallback(() => {
    if (status === 'off' || status === 'error' || status === 'offline') turnOn();
    else turnOff();
  }, [status, turnOn, turnOff]);

  const changePersona = useCallback(async (next) => {
    setPersona(next);
    if (!roomRef.current || !agentRef.current) return;
    try {
      await roomRef.current.localParticipant.performRpc({
        destinationIdentity: agentRef.current, method: 'set_persona', payload: next,
      });
      addLine('—', `(switched to ${next})`);
    } catch (e) { addLine('—', `(persona switch failed: ${e.message})`); }
  }, [addLine]);

  const decide = useCallback((decision) => {
    if (pendingApprovalRef.current) { pendingApprovalRef.current(decision); pendingApprovalRef.current = null; }
    setCard(null);
  }, []);

  useEffect(() => {
    const onUnload = () => { if (roomRef.current) navigator.sendBeacon(`${API}/api/voice/stop`); };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); teardown(); };
  }, [teardown]);

  useEffect(() => {
    if (!card) return;
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'y') decide('approve');
      if (k === 'n') decide('reject');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, decide]);

  const dotClass =
    status === 'live' ? 'live'
      : status === 'booting' || status === 'connecting' ? 'pending'
      : status === 'error' || status === 'offline' ? 'error' : 'off';
  const on = status !== 'off';

  return (
    <div className={`voice-dock${expanded ? ' expanded' : ''}`}>
      <div className="vd-bar">
        <button className="vd-toggle" onClick={toggle} title="Toggle Mayordomo">
          <span className={`vd-dot ${dotClass}`} />
          <span className="vd-name">Mayordomo</span>
          <span className="vd-state">{status}</span>
        </button>
        <button className="vd-caret" onClick={() => setExpanded((v) => !v)}>{expanded ? '▾' : '▴'}</button>
      </div>

      {expanded && (
        <div className="vd-body">
          {err && <div className="vd-err">{err}</div>}
          <div className="vd-row">
            <span className="vd-label">Persona</span>
            <select value={persona} onChange={(e) => changePersona(e.target.value)} disabled={!on}>
              {PERSONAS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <label className="vd-openmic">
            <input type="checkbox" checked={openMic}
              onChange={(e) => { setOpenMic(e.target.checked); setMic(e.target.checked); }} disabled={!on} />
            Open mic (hands-free)
          </label>
          <div className="vd-transcript" ref={transcriptRef}>
            {lines.map((l, i) => <div key={i} className="vd-line"><b>{l.who}</b> {l.text}</div>)}
          </div>
        </div>
      )}

      {card && (
        <div className="vd-card">
          <h4>{card.kind === 'edit' ? `Edit ${card.target}` : 'Run command'}</h4>
          <pre>{card.kind === 'edit' ? card.preview : card.target}</pre>
          <div className="vd-card-actions">
            <button className="vd-reject" onClick={() => decide('reject')}>Reject (N)</button>
            <button className="vd-approve" onClick={() => decide('approve')}>Approve (Y)</button>
          </div>
        </div>
      )}
    </div>
  );
}
