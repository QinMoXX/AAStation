import { useState, useCallback } from 'react';
import { configureClaudeCode } from '../../lib/tauri-api';
import { useSettingsStore } from '../../store/settings-store';
import { toast } from '../../store/toast-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Eye, EyeOff, Bot } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCodeAppInfo {
  nodeId: string;
  label: string;
  /** The port this application listens on. */
  listenPort: number;
}

interface ClaudeCodeDialogProps {
  /** List of Claude Code application nodes detected in the DAG. */
  apps: ClaudeCodeAppInfo[];
  /** The proxy base URL to configure (e.g. "http://127.0.0.1:9527"). */
  proxyUrl: string;
  /** Callback when dialog is closed. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClaudeCodeDialog({ apps, proxyUrl, onClose }: ClaudeCodeDialogProps) {
  const [configuring, setConfiguring] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);

  const handleConfigure = useCallback(async () => {
    if (configuring) return;
    setConfiguring(true);

    try {
      const baseUrl = proxyUrl.replace(/\/$/, '');
      await configureClaudeCode(baseUrl);
      setConfigured(true);
      toast.success('Claude Code 配置写入成功');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`写入 Claude Code 配置失败：${msg}`);
    } finally {
      setConfiguring(false);
    }
  }, [proxyUrl, configuring]);

  const displayProxyUrl = proxyUrl.replace(/\/$/, '');

  // Get auth token from settings store
  const settings = useSettingsStore((s) => s.settings);
  const authToken = settings?.proxyAuthToken || '';
  const maskedToken = authToken.length > 12
    ? authToken.slice(0, 8) + '••••••••' + authToken.slice(-4)
    : '••••••••';

  // Build the settings.json content to display
  const settingsJson = JSON.stringify(
    {
      env: {
        ANTHROPIC_BASE_URL: displayProxyUrl,
        ANTHROPIC_AUTH_TOKEN: tokenVisible ? authToken : maskedToken,
        API_TIMEOUT_MS: '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
      },
    },
    null,
    2,
  );

  const onboardingJson = JSON.stringify(
    { hasCompletedOnboarding: true },
    null,
    2,
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-[600px] overflow-y-auto border-border bg-card/95 shadow-[var(--color-shadow-strong)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-400" />
            Claude Code 代理配置
          </DialogTitle>
          <DialogDescription className="text-muted leading-relaxed">
            检测到 {apps.length} 个 Claude Code 应用节点。发布后需要将本地代理 URL 和认证令牌写入 Claude Code 配置文件，
            使其通过 AAStation 代理转发请求。认证令牌仅用于代理验证，不会转发到上游 API；上游 API Key 由 Provider 节点提供。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Card className="border-border bg-surface/60 shadow-none">
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-card/70 p-3">
                <div className="text-[11px] text-dim">检测到应用</div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{apps.length}</div>
              </div>
              <div className="rounded-xl border border-border bg-card/70 p-3">
                <div className="text-[11px] text-dim">代理基地址</div>
                <code className="mt-1 block text-[13px] font-medium text-blue-300 break-all">
                  {displayProxyUrl}
                </code>
              </div>
            </CardContent>
          </Card>

          {apps.map((app) => (
            <Card key={app.nodeId} className="border-border bg-surface/60 shadow-none">
              <CardContent className="flex items-center gap-2 p-3.5">
                <Bot className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="font-semibold text-foreground text-sm">{app.label}</span>
                <Separator orientation="vertical" className="h-4 bg-border-soft" />
                <span className="text-xs text-muted">代理地址：</span>
                <code className="text-xs font-mono text-blue-300">
                  {`http://127.0.0.1:${app.listenPort}`}
                </code>
              </CardContent>
            </Card>
          ))}

          <Card className="border-border bg-surface/60 shadow-none">
            <CardContent className="space-y-4 p-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-muted">将写入以下配置文件</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setTokenVisible(!tokenVisible)}
                  className="gap-1.5"
                >
                  {tokenVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {tokenVisible ? '隐藏令牌' : '显示令牌'}
                </Button>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] text-dim">~/.claude/settings.json</p>
                <pre className="overflow-x-auto rounded-xl border border-border bg-background/80 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
                  {settingsJson}
                </pre>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] text-dim">~/.claude.json</p>
                <pre className="overflow-x-auto rounded-xl border border-border bg-background/80 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
                  {onboardingJson}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="gap-2 border-t border-border-soft pt-4">
          <Button variant="outline" onClick={onClose}>
            稍后手动配置
          </Button>
          {configured ? (
            <Button variant="success" onClick={onClose}>
              已配置完成
            </Button>
          ) : (
            <Button
              variant="default"
              onClick={handleConfigure}
              disabled={configuring}
            >
              {configuring ? '正在配置...' : '一键写入配置'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
