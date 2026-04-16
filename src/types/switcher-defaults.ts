import type { SwitcherEntry } from './nodes';

/** Default Switcher configuration for a given application type. */
export interface SwitcherDefault {
  /** Suggested label for the Switcher node. */
  label: string;
  /** Default matcher entries to add when an Application of this type connects. */
  entries: Omit<SwitcherEntry, 'id'>[];
}

/** Map from appType to its default Switcher configuration. */
export type SwitcherDefaultsMap = Record<string, SwitcherDefault>;
