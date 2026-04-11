/**
 * Connection validation rules for React Flow edges.
 * Enforces the allowed edge topology:
 *   Listener → Router  ✅
 *   Listener → Forward ✅
 *   Router   → Forward ✅
 *   Forward  → *       ❌ (terminal node)
 *   Router   → Router  ❌ (no nested routing in MVP)
 *   *        → Listener❌ (no back-connections)
 */

export function isValidConnection(
  sourceNodeType: string,
  targetNodeType: string,
): { valid: boolean; reason?: string } {
  if (sourceNodeType === 'forward')
    return { valid: false, reason: 'Forward 是终端节点，不能作为连线起点' };
  if (targetNodeType === 'listener')
    return { valid: false, reason: '不能连接到监听节点' };
  if (sourceNodeType === 'router' && targetNodeType === 'router')
    return { valid: false, reason: 'MVP 不支持嵌套路由' };
  return { valid: true };
}
