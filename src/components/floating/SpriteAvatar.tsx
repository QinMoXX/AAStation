import { cn } from '../../lib/utils';
import { Bot } from 'lucide-react';

// Use dynamic imports for lobehub icons to avoid bundling them in the main chunk.
// These icons are already in the vendor chunk via code splitting.
import { ClaudeCode, Codex, OpenCode } from '@lobehub/icons';

interface SpriteAvatarProps {
  appType: string | null;
  appLabel: string | null;
  hasMessage: boolean;
  onPointerDown: () => void;
}

function AppIcon({ appType }: { appType: string | null }) {
  const size = 48;

  switch (appType) {
    case 'claude_code':
      return <ClaudeCode.Color size={size} />;
    case 'codex_cli':
      return <Codex.Color size={size} />;
    case 'open_code':
      return <OpenCode size={size} />;
    case 'listener':
    default:
      return (
        <div className="w-12 h-12 rounded-2xl bg-[rgba(52,211,153,0.15)] border border-[rgba(52,211,153,0.3)] flex items-center justify-center">
          <Bot className="w-7 h-7 text-emerald-400" />
        </div>
      );
  }
}

export default function SpriteAvatar({ appType, appLabel, hasMessage, onPointerDown }: SpriteAvatarProps) {
  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div
        onPointerDown={onPointerDown}
        className={cn(
          'cursor-grab transition-all duration-500',
          hasMessage && 'animate-pulse'
        )}
      >
        <AppIcon appType={appType} />
      </div>
      {appLabel && (
        <span className="text-[11px] text-muted font-medium max-w-[120px] text-center truncate">
          {appLabel}
        </span>
      )}
      <div
        className={cn(
          'w-1.5 h-1.5 rounded-full transition-colors duration-300',
          hasMessage ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-slate-600'
        )}
      />
    </div>
  );
}
