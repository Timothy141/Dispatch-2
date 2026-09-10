import type { RequestStatus } from './types.js';

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  searching: ['assigned', 'cancelled', 'unfulfilled'],
  assigned: ['en_route', 'arrived', 'searching', 'cancelled'], // back to searching if responder releases
  en_route: ['arrived', 'searching', 'cancelled'],
  arrived: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  unfulfilled: ['searching'], // dispatcher retry
};

export const OPEN_STATUSES: readonly RequestStatus[] = ['searching', 'assigned', 'en_route', 'arrived'];
export const ACTIVE_JOB_STATUSES: readonly RequestStatus[] = ['assigned', 'en_route', 'arrived'];

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export function nextStatuses(from: RequestStatus): readonly RequestStatus[] {
  return TRANSITIONS[from] ?? [];
}
export function isOpen(status: RequestStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
export function isTerminal(status: RequestStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: RequestStatus,
    public readonly to: RequestStatus,
  ) {
    super(`Cannot move request from '${from}' to '${to}'`);
    this.name = 'InvalidTransitionError';
  }
}
