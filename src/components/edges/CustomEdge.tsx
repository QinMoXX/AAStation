import { BaseEdge, getBezierPath, type EdgeProps } from 'reactflow';

/**
 * Custom edge component that highlights when selected.
 * Uses bezier curves for smooth connections.
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
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
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
          stroke: selected ? '#3b82f6' : '#6b7280',
          strokeWidth: selected ? 3 : 2,
        }}
        markerEnd={selected ? 'url(#selected-arrow)' : undefined}
      />
    </>
  );
}
