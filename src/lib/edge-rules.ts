/**
 * Connection validation rules for React Flow edges.
 * Enforces the allowed edge topology for left-to-right flow:
 *   Application → Router       ✅ (output → input)
 *   Application → Provider     ✅ (output → unified)
 *   Router      → Provider     ✅ (entry/default → model/unified)
 *   Provider    → *            ❌ (provider has no output)
 *   Router      → Application  ❌ (wrong direction)
 *   Provider    → Provider     ❌ (no provider chaining)
 */

export function isValidConnection(
  sourceNodeType: string,
  targetNodeType: string,
  _sourceHandle?: string | null,
  _targetHandle?: string | null,
): { valid: boolean; reason?: string } {
  // Provider has no outputs
  if (sourceNodeType === 'provider')
    return { valid: false, reason: 'Provider 是终点节点，不能作为连线起点' };

  // No back-connections to Application
  if (targetNodeType === 'application')
    return { valid: false, reason: '不能连接到 Application 节点' };

  // No Router-to-Router
  if (sourceNodeType === 'router' && targetNodeType === 'router')
    return { valid: false, reason: '不支持嵌套路由' };

  // Provider → Provider
  if (sourceNodeType === 'provider' && targetNodeType === 'provider')
    return { valid: false, reason: '不支持供应商链式连接' };

  // Application → Router (valid)
  if (sourceNodeType === 'application' && targetNodeType === 'router')
    return { valid: true };

  // Application → Provider (valid)
  if (sourceNodeType === 'application' && targetNodeType === 'provider')
    return { valid: true };

  // Router → Provider (valid)
  if (sourceNodeType === 'router' && targetNodeType === 'provider')
    return { valid: true };

  // Router → Application (wrong direction)
  if (sourceNodeType === 'router' && targetNodeType === 'application')
    return { valid: false, reason: '路由节点不能连接到 Application 节点' };

  return { valid: false, reason: '不支持的连接类型' };
}
