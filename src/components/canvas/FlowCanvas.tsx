import { useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  type NodeTypes,
  type EdgeTypes,
  type IsValidConnection,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useFlowStore } from '../../store/flow-store';
import { useAppStore } from '../../store/app-store';
import { isValidConnection } from '../../lib/edge-rules';
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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    // Remove existing toast
    const existing = document.getElementById('connection-toast');
    if (existing) existing.remove();
    if (toastTimer.current) clearTimeout(toastTimer.current);

    const toast = document.createElement('div');
    toast.id = 'connection-toast';
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1e293b',
      color: '#f8fafc',
      padding: '10px 20px',
      borderRadius: '8px',
      fontSize: '13px',
      zIndex: '9999',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s',
    });
    document.body.appendChild(toast);
    toastTimer.current = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }, []);

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
      showToast(lastInvalidReason.current);
      lastInvalidReason.current = null;
    }
  }, [showToast]);

  const defaultEdgeOptions = useMemo(
    () => ({
      animated: true,
      type: 'default' as const,
      style: { strokeWidth: 2, stroke: '#94a3b8' },
    }),
    [],
  );

  return (
    <div style={{ width: '100%', height: '100%', background: '#dfdfd7' }}>
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
        <Background gap={16} size={0} />
      </ReactFlow>
    </div>
  );
}
