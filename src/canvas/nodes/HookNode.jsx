import { Handle, Position } from '@xyflow/react';

export default function HookNode({ data }) {
  const { text, index, accent } = data;

  return (
    <div className="cv-node cv-ingredient cv-hook" style={{ '--accent': accent }}>
      <Handle type="target" position={Position.Left} id="character-in" className="cv-handle" />
      <div className="cv-ingredient-label">Hook #{index + 1}</div>
      <div className="cv-ingredient-text">{text}</div>
      <Handle type="source" position={Position.Right} id="hook-out" className="cv-handle cv-handle-source" />
    </div>
  );
}
