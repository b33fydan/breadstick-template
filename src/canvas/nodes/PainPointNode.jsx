import { Handle, Position } from '@xyflow/react';

export default function PainPointNode({ data }) {
  const { text, index, accent } = data;

  return (
    <div className="cv-node cv-ingredient cv-painpoint" style={{ '--accent': accent }}>
      <Handle type="target" position={Position.Left} id="character-in" className="cv-handle" />
      <div className="cv-ingredient-label">Pain Point #{index + 1}</div>
      <div className="cv-ingredient-text">{text}</div>
      <Handle type="source" position={Position.Right} id="painpoint-out" className="cv-handle cv-handle-source" />
    </div>
  );
}
