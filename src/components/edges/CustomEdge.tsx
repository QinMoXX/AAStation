import { BaseEdge, getSmoothStepPath, type EdgeProps } from 'reactflow';

/**
 * Custom edge component that highlights when selected.
 */
export default function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  selected,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      {/* Selection background for better visibility */}
      {selected && (
        <path
          id={`${id}-bg`}
          d={edgePath}
          style={{
            stroke: '#3b82f6',
            strokeWidth: 6,
            fill: 'none',
            opacity: 0.3,
          }}
        />
      )}
      {/* Main edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: selected ? '#3b82f6' : '#94a3b8',
          strokeWidth: selected ? 3 : 2,
        }}
        markerEnd={selected ? 'url(#selected-arrow)' : undefined}
      />
    </>
  );
}
