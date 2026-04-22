import { SVGProps } from 'react';
import {
  Alibaba,
  Bailian,
  OpenAI,
  Anthropic,
  DeepSeek,
  Minimax,
  Moonshot,
  Zhipu,
  OpenRouter,
  TencentCloud,
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
  zhipu: Zhipu,
  openrouter: OpenRouter,
  tencentcloud: TencentCloud,
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
  // Handle [lobehub:IconName] format
  if (iconKey.startsWith(LOBEHUB_PREFIX) && iconKey.endsWith(LOBEHUB_SUFFIX)) {
    const iconName = iconKey.slice(LOBEHUB_PREFIX.length, -LOBEHUB_SUFFIX.length);
    // Return a wrapper component that renders the LobeHub icon
    const LobeIcon = (props: SVGProps<SVGSVGElement>) => {
      const LobeComponent = LOBEHUB_ICONS[iconName.toLowerCase()];
      if (LobeComponent) {
        return <LobeComponent size={Number(props.width) || 24} />;
      }
      return <FallbackIcon {...props} />;
    };
    return LobeIcon;
  }

  // Handle preset ID format (e.g., "openai", "anthropic")
  if (LOBEHUB_ICONS[iconKey.toLowerCase()]) {
    const LobeIcon = (props: SVGProps<SVGSVGElement>) => {
      const LobeComponent = LOBEHUB_ICONS[iconKey.toLowerCase()];
      if (LobeComponent) {
        return <LobeComponent size={Number(props.width) || 24} />;
      }
      return <FallbackIcon {...props} />;
    };
    return LobeIcon;
  }

  // Handle custom provider
  if (iconKey === 'custom') {
    return CustomProviderIcon;
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

export { Alibaba, Bailian, OpenAI, Anthropic, DeepSeek, Minimax, Moonshot, Zhipu, OpenRouter, TencentCloud };
