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
            stroke: '#60a5fa',
            strokeWidth: 6,
            fill: 'none',
            opacity: 0.34,
          }}
        />
      )}
      {/* Main edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: selected ? '#60a5fa' : '#64748b',
          strokeWidth: selected ? 3 : 2,
          filter: selected ? 'drop-shadow(0 0 10px rgba(96,165,250,0.35))' : 'none',
        }}
        markerEnd={selected ? 'url(#selected-arrow)' : undefined}
      />
    </>
  );
}
