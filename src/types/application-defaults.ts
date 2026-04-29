import type { AppType } from './nodes';
import type { NodeTag } from './tag';

/** Config for one application node type. */
export interface ApplicationDefault {
  /** Label shown in chips/sidebar for this app type. */
  displayLabel: string;
  /** Default node label when creating this app type. */
  defaultNodeLabel: string;
  /** Icon key string (supports [lobehub:IconName] and local keys). */
  icon: string;
  /** Optional helper text shown in node panel. */
  helpText?: string;
  /** Capability tags for compatibility filtering. */
  tag: NodeTag[];
  /** Official website URL for this application (optional). */
  websiteUrl?: string;
}

/** Map of application node defaults by app type. */
export type ApplicationDefaultsMap = Record<AppType, ApplicationDefault>;
