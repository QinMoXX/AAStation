import type { AppType } from './nodes';

/** Config for one application node type. */
export interface ApplicationDefault {
  /** Label shown in chips/sidebar for this app type. */
  displayLabel: string;
  /** Default node label when creating this app type. */
  defaultNodeLabel: string;
  /** Optional helper text shown in node panel. */
  helpText?: string;
}

/** Map of application node defaults by app type. */
export type ApplicationDefaultsMap = Record<AppType, ApplicationDefault>;
