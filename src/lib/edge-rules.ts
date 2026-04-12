/**
 * Connection validation rules for React Flow edges.
 * Enforces the allowed edge topology for left-to-right flow:
 *   Provider → Router    ✅ (model/unified → entry/default)
 *   Provider → Terminal  ✅ (model/unified → input)
 *   Router   → Terminal  ✅ (output → input)
 *   Terminal → *         ❌ (terminal has no output)
 *   Router   → Provider  ❌ (wrong direction)
 *   Provider → Provider  ❌ (no provider chaining)
 */

export function isValidConnection(
  sourceNodeType: string,
  targetNodeType: string,
  _sourceHandle?: string | null,
  _targetHandle?: string | null,
): { valid: boolean; reason?: string } {
  // Terminal has no outputs
  if (sourceNodeType === 'terminal')
    return { valid: false, reason: 'Terminal 是终端节点，不能作为连线起点' };

  // No back-connections to Provider
  if (targetNodeType === 'provider')
    return { valid: false, reason: '不能连接到供应商节点' };

  // No Router-to-Router
  if (sourceNodeType === 'router' && targetNodeType === 'router')
    return { valid: false, reason: '不支持嵌套路由' };

  // Provider → Provider
  if (sourceNodeType === 'provider' && targetNodeType === 'provider')
    return { valid: false, reason: '不支持供应商链式连接' };

  // Router → Router already handled above

  // Provider → Router (valid)
  if (sourceNodeType === 'provider' && targetNodeType === 'router')
    return { valid: true };

  // Provider → Terminal (valid)
  if (sourceNodeType === 'provider' && targetNodeType === 'terminal')
    return { valid: true };

  // Router → Terminal (valid)
  if (sourceNodeType === 'router' && targetNodeType === 'terminal')
    return { valid: true };

  // Router → Provider (wrong direction)
  if (sourceNodeType === 'router' && targetNodeType === 'provider')
    return { valid: false, reason: '路由节点不能连接到供应商节点' };

  return { valid: false, reason: '不支持的连接类型' };
}
