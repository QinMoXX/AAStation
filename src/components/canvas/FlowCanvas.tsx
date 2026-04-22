import { useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  MiniMap,
  type NodeTypes,
  type EdgeTypes,
  type IsValidConnection,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useFlowStore } from '../../store/flow-store';
import { useAppStore } from '../../store/app-store';
import { isValidConnection } from '../../lib/edge-rules';
import { toast } from '../../store/toast-store';
import type { SwitcherNodeData } from '../../types';
import ProviderNode from '../nodes/ProviderNode';
import SwitcherNode from '../nodes/SwitcherNode';
import ApplicationNode from '../nodes/ApplicationNode';
import CustomEdge from '../edges/CustomEdge';

// Register custom node type components.
const nodeTypes: NodeTypes = {
  provider: ProviderNode,
  switcher: SwitcherNode,
  application: ApplicationNode,
};

// Register custom edge type for selection highlighting.
const edgeTypes: EdgeTypes = {
  default: CustomEdge,
  smoothstep: CustomEdge,
};

/** The main React Flow canvas component. */
export default function FlowCanvas() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);

  // Track the last validation failure reason for showing a toast
  const lastInvalidReason = useRef<string | null>(null);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  const checkValidConnection: IsValidConnection = useCallback(
    (edge) => {
      if (!edge.source || !edge.target) return false;
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) return false;

      // Get entries from source node if it's a switcher
      const sourceEntries = sourceNode.data.nodeType === 'switcher'
        ? (sourceNode.data as SwitcherNodeData).entries
        : undefined;

      const result = isValidConnection(
        sourceNode.data.nodeType,
        targetNode.data.nodeType,
        edge.sourceHandle,
        edge.targetHandle,
        sourceEntries,
      );

      if (!result.valid && result.reason) {
        lastInvalidReason.current = result.reason;
      } else {
        lastInvalidReason.current = null;
      }

      return result.valid;
    },
    [nodes],
  );

  const handleConnectEnd = useCallback(() => {
    if (lastInvalidReason.current) {
      toast.warning(lastInvalidReason.current, 3000);
      lastInvalidReason.current = null;
    }
  }, []);

  const defaultEdgeOptions = useMemo(
    () => ({
      animated: true,
      type: 'default' as const,
      style: { strokeWidth: 2, stroke: '#6b7280' },
    }),
    [],
  );

  return (
    <div style={{ width: '100%', height: '100%', background: '#1a1a1a' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onConnectEnd={handleConnectEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        isValidConnection={checkValidConnection}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={['Backspace', 'Delete']}
        snapToGrid
        snapGrid={[16, 16]}
      >
        <Background gap={16} size={0} color="#333" />
        <MiniMap
          nodeColor={(node) => {
            switch (node.data?.nodeType) {
              case 'provider': return '#3b82f6';
              case 'switcher': return '#f97316';
              case 'application': return '#22c55e';
              default: return '#6b7280';
            }
          }}
          maskColor="rgba(0,0,0,0.7)"
          style={{ background: '#1a1a1a', border: '1px solid #374151', borderRadius: 6 }}
        />
      </ReactFlow>
    </div>
  );
}
