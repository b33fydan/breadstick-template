// src/canvas/composer/ConductorNode.jsx
import { useContext, useState, useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { CanvasCtx } from '../CanvasView';
import './composer.css';

// Conversation shape in nodeOutputs[id]:
// { status: 'idle'|'composing'|'proposing'|'reviewing'|'error',
//   turns: [{ role: 'user'|'assistant', text, card? }], error? }
// card = { lane, intent, nodeCount, edgeCount, rationale, warnings: [] }

export default function ConductorNode({ id }) {
  const { nodeOutputs, onConductorSend, conductorBatch } = useContext(CanvasCtx);
  const out = nodeOutputs?.[id] || {};
  const turns = out.turns || [];
  const status = out.status || 'idle';
  const busy = status === 'composing';

  const [draft, setDraft] = useState('');
  const logRef = useRef(null);

  // Pin the log to the latest turn. Scroll position is render-local UI state,
  // not node state — the one legitimate effect in this component.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [turns.length, status]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    onConductorSend?.(id, text);
  };

  const statusLine = {
    idle: 'ready', composing: 'composing…',
    proposing: 'proposing', reviewing: 'awaiting your review', error: out.error || 'error',
  }[status];

  return (
    <div className="cv-node cv-conductor nowheel">
      <div className="cv-conductor-header" style={{ background: 'linear-gradient(135deg, #C9A227, #6b5613)' }}>
        <span className="cv-conductor-dot" style={{ background: busy ? '#e85d75' : conductorBatch ? '#00FFFF' : '#C9A227', color: busy ? '#e85d75' : conductorBatch ? '#00FFFF' : '#C9A227' }} />
        <strong>Conductor</strong>
        <span className="cv-conductor-badge">OPUS 4.8</span>
      </div>

      <div className="cv-conductor-log nodrag nowheel" ref={logRef}>
        {turns.length === 0 && (
          <div className="cv-conductor-msg-bot">
            Describe a deliverable — I&apos;ll stage the pipeline as ghost nodes for your review.
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="cv-conductor-msg-user">{t.text}</div>
          ) : (
            <div key={i} className="cv-conductor-msg-bot">
              {t.text}
              {t.card && (
                <div className="cv-conductor-card">
                  <span className="cv-conductor-card-lane">{t.card.lane}</span>
                  {t.card.intent}
                  <div className="cv-conductor-card-meta">
                    {t.card.nodeCount} nodes · {t.card.edgeCount} wires — {t.card.rationale}
                  </div>
                  {t.card.warnings?.length > 0 && (
                    <details className="cv-conductor-warn">
                      <summary>{t.card.warnings.length} adjustments</summary>
                      {t.card.warnings.map((w, j) => <div key={j}>• {w}</div>)}
                    </details>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </div>

      <div className="cv-conductor-input nodrag">
        <textarea
          value={draft}
          placeholder='e.g. "45s UGC reel about a product, QC-gated"'
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="cv-btn" disabled={busy || !draft.trim()}
          onClick={(e) => { e.stopPropagation(); send(); }}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
      <div className={`cv-conductor-status${busy ? ' busy' : ''}`}>{statusLine}</div>

      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}
