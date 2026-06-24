import { Handle, Position } from '@xyflow/react';
import { useState } from 'react';

export default function ImageNode({ data }) {
  const { prompt, status = 'waiting' } = data;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`cv-node cv-output cv-output-${status}`}>
      <Handle type="target" position={Position.Left} id="script-in" className="cv-handle" />
      <div className="cv-output-icon">I</div>
      <div className="cv-output-label">ChatGPT Image</div>
      {prompt && (
        <button className="cv-btn cv-btn-sm" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      )}
    </div>
  );
}
