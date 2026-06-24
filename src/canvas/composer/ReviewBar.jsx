// src/canvas/composer/ReviewBar.jsx
// Floating accept/reject chrome for a pending Conductor batch. Mounted inside
// <ReactFlow> as a Panel. All actions go through ctx handlers; this component
// owns zero canvas state.
import { useContext } from 'react';
import { Panel } from '@xyflow/react';
import { CanvasCtx } from '../CanvasView';

export default function ReviewBar() {
  const { conductorBatch, onConductorAccept, onConductorDiscard,
          onConductorRejectNode, onConductorHover } = useContext(CanvasCtx);
  if (!conductorBatch) return null;

  const { nodes, warnings } = conductorBatch; // [{ id, label }], [string]

  return (
    <Panel position="bottom-center">
      <div className="cv-review-bar nodrag">
        <span className="cv-review-bar-title">
          Conductor proposal — {nodes.length} node{nodes.length === 1 ? '' : 's'}
        </span>
        {nodes.map((n) => (
          <span key={n.id} className="cv-review-chip"
            onMouseEnter={() => onConductorHover?.(n.id, true)}
            onMouseLeave={() => onConductorHover?.(n.id, false)}>
            {n.label}
            <button title="Reject this node"
              onClick={(e) => { e.stopPropagation(); onConductorRejectNode?.(n.id); }}>×</button>
          </span>
        ))}
        <div className="cv-review-actions">
          <button className="cv-review-accept" onClick={() => onConductorAccept?.()}>✓ Accept all</button>
          <button className="cv-review-discard" onClick={() => onConductorDiscard?.()}>✗ Discard</button>
        </div>
        {warnings?.length > 0 && (
          <div className="cv-review-warnings">⚠ {warnings.join(' · ')}</div>
        )}
      </div>
    </Panel>
  );
}
