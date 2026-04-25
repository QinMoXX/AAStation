import { SVGProps } from 'react';
import {
  Alibaba,
  Bailian,
  OpenAI,
  Anthropic,
  DeepSeek,
  Minimax,
  Moonshot,
  Volcengine,
  Zhipu,
  OpenRouter,
  TencentCloud,
  ClaudeCode,
  Codex,
  OpenCode,
} from '@lobehub/icons';

// ---------------------------------------------------------------------------
// Provider Icon Components
// Supports two formats:
// 1. "[lobehub:IconName]" - dynamically loads from @lobehub/icons
// 2. "custom" - uses built-in CustomProviderIcon
// ---------------------------------------------------------------------------

/** Fallback icon for custom providers */
export function CustomProviderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

/** Local icon for listener application type. */
function ListenerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      {...props}
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

/** Local icon for switcher middleware type. */
function SwitcherIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      {...props}
    >
      <path d="M16 3h5v5" />
      <path d="M8 3H3v5" />
      <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
      <path d="m15 9 6-6" />
    </svg>
  );
}

/** Local icon for poller middleware type. */
function PollerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      {...props}
    >
      <path d="M3 12a9 9 0 0 1 15.5-6.2" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

/** Fallback icon when provider icon not found */
function FallbackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// LobeHub Icons mapping
// Maps preset ID to LobeHub icon component
// ---------------------------------------------------------------------------

const LOBEHUB_ICONS: Record<string, React.FC<{ size?: number }>> = {
  alibaba: Alibaba,
  bailian: Bailian,
  kimi: Moonshot,
  openai: OpenAI,
  anthropic: Anthropic,
  deepseek: DeepSeek,
  minimax: Minimax,
  moonshot: Moonshot,
  ark: Volcengine,
  volcengine: Volcengine,
  zhipu: Zhipu,
  openrouter: OpenRouter,
  tencentcloud: TencentCloud,
  claudecode: ClaudeCode.Color,
  codex: Codex.Color,
  opencode: OpenCode,
};

/** Local icon key mapping for app/middleware/custom presets. */
const LOCAL_ICONS: Record<string, React.FC<SVGProps<SVGSVGElement>>> = {
  custom: CustomProviderIcon,
  listener: ListenerIcon,
  switcher: SwitcherIcon,
  poller: PollerIcon,
};

// ---------------------------------------------------------------------------
// Icon Parser and Resolver
// ---------------------------------------------------------------------------

const LOBEHUB_PREFIX = '[lobehub:';
const LOBEHUB_SUFFIX = ']';

/**
 * Parses icon string and returns the appropriate icon component.
 * 
 * Format:
 * - "[lobehub:OpenAI]" -> loads OpenAI from @lobehub/icons
 * - "openai" -> uses preset ID lookup in LOBEHUB_ICONS
 * - "custom" -> uses CustomProviderIcon
 */
export function getProviderIcon(
  iconKey: string
): React.FC<SVGProps<SVGSVGElement>> | null {
  const normalizedIconKey = iconKey.trim();

  // Handle [lobehub:IconName] format
  if (normalizedIconKey.startsWith(LOBEHUB_PREFIX) && normalizedIconKey.endsWith(LOBEHUB_SUFFIX)) {
    const iconName = normalizedIconKey.slice(LOBEHUB_PREFIX.length, -LOBEHUB_SUFFIX.length);
    // Return a wrapper component that renders the LobeHub icon
    const LobeIcon = (props: SVGProps<SVGSVGElement>) => {
      const LobeComponent = LOBEHUB_ICONS[iconName.toLowerCase()];
      if (LobeComponent) {
        return <LobeComponent size={Number(props.width) || Number(props.height) || 24} />;
      }
      return <FallbackIcon {...props} />;
    };
    return LobeIcon;
  }

  // Handle local key format (e.g., "custom", "listener", "switcher")
  const localIcon = LOCAL_ICONS[normalizedIconKey.toLowerCase()];
  if (localIcon) {
    return localIcon;
  }

  // Handle preset ID format (e.g., "openai", "anthropic")
  if (LOBEHUB_ICONS[normalizedIconKey.toLowerCase()]) {
    const LobeIcon = (props: SVGProps<SVGSVGElement>) => {
      const LobeComponent = LOBEHUB_ICONS[normalizedIconKey.toLowerCase()];
      if (LobeComponent) {
        return <LobeComponent size={Number(props.width) || Number(props.height) || 24} />;
      }
      return <FallbackIcon {...props} />;
    };
    return LobeIcon;
  }

  // Fallback
  return null;
}

/**
 * Gets the icon component by preset ID (for backward compatibility).
 */
export function getProviderIconById(presetId: string): React.FC<SVGProps<SVGSVGElement>> {
  return getProviderIcon(presetId) || FallbackIcon;
}

// ---------------------------------------------------------------------------
// Re-export LobeHub icons for direct usage
// ---------------------------------------------------------------------------

export { Alibaba, Bailian, OpenAI, Anthropic, DeepSeek, Minimax, Moonshot, Volcengine, Zhipu, OpenRouter, TencentCloud };
