import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { EDGE_RULE_MESSAGES, isValidConnection } from '../../lib/edge-rules';
import { getProxyMetrics } from '../../lib/tauri-api';
import { toast } from '../../store/toast-store';
import type { ProviderRuntimeState, SwitcherNodeData } from '../../types';
import ProviderNode from '../nodes/ProviderNode';
import SwitcherNode from '../nodes/SwitcherNode';
import PollerNode from '../nodes/PollerNode';
import ApplicationNode from '../nodes/ApplicationNode';
import CustomEdge from '../edges/CustomEdge';

const RUNTIME_POLL_INTERVAL_MS = 4000;

// Register custom node type components.
const nodeTypes: NodeTypes = {
  provider: ProviderNode,
  switcher: SwitcherNode,
  poller: PollerNode,
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
  const proxyStatus = useAppStore((s) => s.proxyStatus);
  const [providerRuntimeById, setProviderRuntimeById] = useState<Record<string, ProviderRuntimeState>>({});

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
      const hasExistingFromSameOutput = edges.some(
        (e) =>
          e.source === edge.source &&
          (e.sourceHandle ?? null) === (edge.sourceHandle ?? null),
      );
      if (hasExistingFromSameOutput) {
        lastInvalidReason.current = EDGE_RULE_MESSAGES.SOURCE_HANDLE_ALREADY_CONNECTED;
        return false;
      }

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
    [nodes, edges],
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
      style: { strokeWidth: 1.75, stroke: 'rgba(148, 163, 184, 0.7)' },
    }),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    const loadRuntime = async () => {
      try {
        const snapshot = await getProxyMetrics();
        if (disposed) return;
        setProviderRuntimeById(
          Object.fromEntries(
            snapshot.provider_runtime.map((item) => [item.provider_id, item]),
          ),
        );
      } catch {
        if (!disposed) {
          setProviderRuntimeById({});
        }
      }
    };

    loadRuntime();
    if (proxyStatus.running) {
      timer = window.setInterval(loadRuntime, RUNTIME_POLL_INTERVAL_MS);
    }

    return () => {
      disposed = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [proxyStatus.running, proxyStatus.published_at]);

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) =>
        node.data.nodeType === 'provider'
          ? {
              ...node,
              data: {
                ...node.data,
                runtimeState: providerRuntimeById[node.id] ?? null,
              },
            }
          : node,
      ),
    [nodes, providerRuntimeById],
  );

  return (
    <div className="ui-canvas-shell">
      <ReactFlow
        nodes={renderedNodes}
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
        <Background gap={22} size={1} color="rgba(148, 163, 184, 0.08)" />
        <MiniMap
          nodeColor={(node) => {
            switch (node.data?.nodeType) {
              case 'provider': return '#3b82f6';
              case 'switcher': return '#f97316';
              case 'poller': return '#a855f7';
              case 'application': return '#22c55e';
              default: return '#6b7280';
            }
          }}
          maskColor="rgba(2,8,23,0.78)"
          style={{
            background: 'rgba(8, 12, 22, 0.88)',
            border: '1px solid rgba(148, 163, 184, 0.14)',
            borderRadius: 14,
          }}
        />
      </ReactFlow>
    </div>
  );
}
