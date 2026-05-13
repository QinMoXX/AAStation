import { cn } from '../../lib/utils';
import { Bot } from 'lucide-react';
import { ClaudeCode, Codex, OpenCode } from '@lobehub/icons';

interface SpriteAvatarProps {
  appType: string | null;
  appLabel: string | null;
  hasMessage: boolean;
  onPointerDown: () => void;
}

function AppIcon({ appType }: { appType: string | null }) {
  switch (appType) {
    case 'claude_code':
      return <ClaudeCode.Color size={36} />;
    case 'codex_cli':
      return <Codex.Color size={36} />;
    case 'open_code':
      return <OpenCode size={36} />;
    case 'listener':
    default:
      return <Bot className="w-7 h-7 text-primary" />;
  }
}

export default function SpriteAvatar({ appType, appLabel, hasMessage, onPointerDown }: SpriteAvatarProps) {
  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div
        onPointerDown={onPointerDown}
        className={cn(
          'w-14 h-14 rounded-full flex items-center justify-center',
          'bg-[rgba(15,23,42,0.9)] border border-border',
          'shadow-[var(--color-shadow-soft)]',
          'cursor-grab transition-all duration-500',
          hasMessage && 'animate-pulse shadow-[0_0_16px_rgba(59,130,246,0.4)]'
        )}
      >
        <AppIcon appType={appType} />
      </div>
      {appLabel && (
        <span className="text-[11px] text-muted font-medium max-w-[120px] text-center truncate">
          {appLabel}
        </span>
      )}
    </div>
  );
}
