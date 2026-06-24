import { Handle, Position } from '@xyflow/react';
import { useState } from 'react';

export default function VideoNode({ data }) {
  const { clipCount, status = 'waiting', onOpen } = data;
  const [copied, setCopied] = useState(false);

  return (
    <div className={`cv-node cv-output cv-output-video cv-output-${status}`}>
      <Handle type="target" position={Position.Left} id="script-in" className="cv-handle" />
      <div className="cv-output-icon">K</div>
      <div className="cv-output-label">Video Clips</div>
      {clipCount > 0 && (
        <div className="cv-output-meta">{clipCount} clips</div>
      )}
      {status === 'ready' && (
        <button className="cv-btn cv-btn-sm" onClick={onOpen}>Open</button>
      )}
    </div>
  );
}
