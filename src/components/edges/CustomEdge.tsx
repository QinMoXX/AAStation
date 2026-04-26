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
            strokeWidth: 5,
            fill: 'none',
            opacity: 0.2,
          }}
        />
      )}
      {/* Main edge path */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: selected ? '#60a5fa' : 'rgba(148, 163, 184, 0.72)',
          strokeWidth: selected ? 2.5 : 1.75,
          filter: selected ? 'drop-shadow(0 0 6px rgba(96,165,250,0.2))' : 'none',
        }}
        markerEnd={selected ? 'url(#selected-arrow)' : undefined}
      />
    </>
  );
}
