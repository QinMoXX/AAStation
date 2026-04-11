import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Controls,
  Background,
  type NodeTypes,
  type IsValidConnection,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useFlowStore } from '../../store/flow-store';
import { useAppStore } from '../../store/app-store';
import { isValidConnection } from '../../lib/edge-rules';
import ListenerNode from '../nodes/ListenerNode';
import RouterNode from '../nodes/RouterNode';
import ForwardNode from '../nodes/ForwardNode';

// Register custom node type components.
const nodeTypes: NodeTypes = {
  listener: ListenerNode,
  router: RouterNode,
  forward: ForwardNode,
};

/** The main React Flow canvas component. */
export default function FlowCanvas() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const setSelectedNodeId = useAppStore((s) => s.setSelectedNodeId);

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

      const result = isValidConnection(
        sourceNode.data.nodeType,
        targetNode.data.nodeType,
      );
      return result.valid;
    },
    [nodes],
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      animated: true,
      style: { strokeWidth: 2, stroke: '#94a3b8' },
    }),
    [],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        isValidConnection={checkValidConnection}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={['Backspace', 'Delete']}
        snapToGrid
        snapGrid={[16, 16]}
      >
        <Controls />
        <Background gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
