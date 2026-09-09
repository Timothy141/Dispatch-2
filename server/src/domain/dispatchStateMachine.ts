import type { DispatchStatus } from './types.js';

const TRANSITIONS: Record<DispatchStatus, readonly DispatchStatus[]> = {
  requested: ['acknowledged', 'en_route', 'on_scene', 'cancelled'],
  acknowledged: ['en_route', 'on_scene', 'cancelled'],
  en_route: ['on_scene', 'resolved', 'cancelled'],
  on_scene: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly DispatchStatus[] = ['resolved', 'cancelled'];

export function canTransition(from: DispatchStatus, to: DispatchStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: DispatchStatus): readonly DispatchStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function isTerminal(status: DispatchStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: DispatchStatus,
    public readonly to: DispatchStatus,
  ) {
    super(`Cannot move dispatch from '${from}' to '${to}'`);
    this.name = 'InvalidTransitionError';
  }
}
