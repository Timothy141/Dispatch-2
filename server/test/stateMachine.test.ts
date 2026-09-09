import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal, nextStatuses } from '../src/domain/dispatchStateMachine.js';

describe('dispatch state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('requested', 'acknowledged')).toBe(true);
    expect(canTransition('acknowledged', 'en_route')).toBe(true);
    expect(canTransition('en_route', 'on_scene')).toBe(true);
    expect(canTransition('on_scene', 'resolved')).toBe(true);
  });
  it('allows cancellation from any open state and skipping ahead', () => {
    for (const s of ['requested', 'acknowledged', 'en_route', 'on_scene'] as const) {
      expect(canTransition(s, 'cancelled')).toBe(true);
    }
    expect(canTransition('requested', 'on_scene')).toBe(true);
  });
  it('blocks moving backwards or out of terminal states', () => {
    expect(canTransition('on_scene', 'en_route')).toBe(false);
    expect(canTransition('resolved', 'en_route')).toBe(false);
    expect(canTransition('cancelled', 'requested')).toBe(false);
    expect(nextStatuses('resolved')).toEqual([]);
    expect(isTerminal('resolved')).toBe(true);
    expect(isTerminal('en_route')).toBe(false);
  });
});
