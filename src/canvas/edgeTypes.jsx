import { BaseEdge, getSmoothStepPath } from '@xyflow/react';

function PulseEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }) {
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 16,
  });

  const isActive = data?.active;
  const color = data?.color || '#C9A227';

  return (
    <>
      {/* Glow layer */}
      {isActive && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: color,
            strokeWidth: 6,
            opacity: 0.25,
            filter: `drop-shadow(0 0 6px ${color})`,
            ...style,
          }}
        />
      )}
      {/* Main edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: 2,
          opacity: isActive ? 1 : 0.4,
          transition: 'opacity 0.3s, stroke 0.3s',
          ...style,
        }}
      />
    </>
  );
}

export const edgeTypes = {
  pulse: PulseEdge,
};
