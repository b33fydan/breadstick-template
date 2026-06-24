import { Handle, Position } from '@xyflow/react';

export default function ConversionLevelNode({ data }) {
  const { level } = data;
  if (!level) return null;

  return (
    <div className="cv-node cv-conversion">
      <div className="cv-conversion-name">{level.name}</div>
      <div className="cv-conversion-ratio">{level.ratio}</div>
      <Handle type="source" position={Position.Right} id="conversion-out" className="cv-handle cv-handle-source" />
    </div>
  );
}
