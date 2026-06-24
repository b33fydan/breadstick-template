import { Handle, Position } from '@xyflow/react';

export default function ScriptTypeNode({ data }) {
  const { scriptType } = data;
  if (!scriptType) return null;

  return (
    <div className="cv-node cv-scripttype">
      <div className="cv-scripttype-name">{scriptType.name}</div>
      <div className="cv-scripttype-meta">{scriptType.duration}</div>
      <Handle type="source" position={Position.Right} id="scripttype-out" className="cv-handle cv-handle-source" />
    </div>
  );
}
