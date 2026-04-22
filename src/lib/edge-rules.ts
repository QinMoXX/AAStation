/**
 * Connection validation rules for React Flow edges.
 * Enforces the allowed edge topology for left-to-right flow:
 *   Application → Switcher      ✅ (output → input)
 *   Application → Provider      ✅ (output → unified)
 *   Switcher    → Provider      ✅ (entry/default → model/unified)
 *   Provider    → *             ❌ (provider has no output)
 *   Switcher    → Application   ❌ (wrong direction)
 *   Provider    → Provider      ❌ (no provider chaining)
 *
 * Handle type matching rules:
 *   source:model → target:model  ✅ (model matcher → provider model)
 *   source:any   → target:any    ✅ (generic → generic)
 *   source:any   → target:model  ✅ (generic can connect to model)
 *   source:model → target:any    ❌ (model matcher should connect to a specific model)
 */

import type { SwitcherEntry } from '../types';

/** Determine the handle type of a source handle based on node type and handle ID. */
function getSourceHandleType(
  sourceNodeType: string,
  sourceHandle: string | null | undefined,
  entries: SwitcherEntry[],
): 'model' | 'any' {
  if (sourceNodeType === 'application') return 'any';
  if (sourceNodeType === 'switcher') {
    if (!sourceHandle) return 'any';
    // Default handle is always 'any'
    if (sourceHandle === 'default') return 'any';
    // Entry handles: check the entry's matchType
    if (sourceHandle.startsWith('entry-')) {
      const entryId = sourceHandle.slice('entry-'.length);
      const entry = entries.find((e) => e.id === entryId);
      if (entry && entry.matchType === 'model') return 'model';
    }
    return 'any';
  }
  return 'any';
}

/** Determine the handle type of a target handle based on node type and handle ID. */
function getTargetHandleType(
  targetNodeType: string,
  targetHandle: string | null | undefined,
): 'model' | 'any' {
  if (targetNodeType === 'switcher') return 'any';
  if (targetNodeType === 'provider') {
    if (!targetHandle) return 'any';
    if (targetHandle.startsWith('model-')) return 'model';
    return 'any'; // unified or others
  }
  return 'any';
}

export function isValidConnection(
  sourceNodeType: string,
  targetNodeType: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  sourceEntries?: SwitcherEntry[],
): { valid: boolean; reason?: string } {
  // Provider has no outputs
  if (sourceNodeType === 'provider')
    return { valid: false, reason: 'Provider 是终点节点，不能作为连线起点' };

  // No back-connections to Application
  if (targetNodeType === 'application')
    return { valid: false, reason: '不能连接到 Application 节点' };

  // No Switcher-to-Switcher
  if (sourceNodeType === 'switcher' && targetNodeType === 'switcher')
    return { valid: false, reason: '不支持嵌套交换器' };

  // Application → Switcher (valid)
  if (sourceNodeType === 'application' && targetNodeType === 'switcher')
    return { valid: true };

  // Application → Provider (valid)
  if (sourceNodeType === 'application' && targetNodeType === 'provider')
    return { valid: true };

  // Switcher → Provider: check handle type matching
  if (sourceNodeType === 'switcher' && targetNodeType === 'provider') {
    const srcType = getSourceHandleType('switcher', sourceHandle ?? null, sourceEntries ?? []);
    const tgtType = getTargetHandleType('provider', targetHandle ?? null);

    // model → model: ✅
    if (srcType === 'model' && tgtType === 'model') return { valid: true };
    // any → any: ✅
    if (srcType === 'any' && tgtType === 'any') return { valid: true };
    // any → model: ✅ (generic can connect to specific model)
    if (srcType === 'any' && tgtType === 'model') return { valid: true };
    // model → any: ❌ (model matcher should target a specific model handle)
    if (srcType === 'model' && tgtType === 'any') {
      return {
        valid: false,
        reason: '模型匹配器的连线目标应该是 Provider 上的具体模型连接点，而非统一入口',
      };
    }
    return { valid: true };
  }

  // Switcher → Application (wrong direction)
  if (sourceNodeType === 'switcher' && targetNodeType === 'application')
    return { valid: false, reason: '交换器节点不能连接到 Application 节点' };

  return { valid: false, reason: '不支持的连接类型' };
}

/**
 * Get the handle type for a given handle ID on a given node type.
 * Used externally (e.g. by FlowCanvas) for validation.
 */
export { getSourceHandleType, getTargetHandleType };
