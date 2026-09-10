import { describe, expect, it } from 'vitest';
import { canTransition, isOpen, isTerminal, nextStatuses } from '../src/domain/requestStateMachine.js';
import { priorityFor } from '../src/domain/types.js';

describe('request state machine', () => {
  it('follows the happy path', () => {
    expect(canTransition('searching', 'assigned')).toBe(true);
    expect(canTransition('assigned', 'en_route')).toBe(true);
    expect(canTransition('en_route', 'arrived')).toBe(true);
    expect(canTransition('arrived', 'completed')).toBe(true);
  });
  it('lets a responder release back to search and a dispatcher retry unfulfilled', () => {
    expect(canTransition('assigned', 'searching')).toBe(true);
    expect(canTransition('en_route', 'searching')).toBe(true);
    expect(canTransition('unfulfilled', 'searching')).toBe(true);
    expect(canTransition('arrived', 'searching')).toBe(false);
  });
  it('blocks terminal states', () => {
    expect(nextStatuses('completed')).toEqual([]);
    expect(canTransition('cancelled', 'searching')).toBe(false);
    expect(isTerminal('completed')).toBe(true);
    expect(isOpen('arrived')).toBe(true);
    expect(isOpen('unfulfilled')).toBe(false);
  });
});

describe('priorityFor', () => {
  it('escalates from flags and defaults medical/fire to urgent', () => {
    expect(priorityFor('security', [])).toBe('standard');
    expect(priorityFor('security', ['in_progress'])).toBe('urgent');
    expect(priorityFor('security', ['suspicious', 'armed'])).toBe('critical');
    expect(priorityFor('medical', [])).toBe('urgent');
    expect(priorityFor('medical', ['not_breathing'])).toBe('critical');
    expect(priorityFor('fire', ['smoke_only'])).toBe('urgent');
    expect(priorityFor('fire', ['unknown_flag'])).toBe('urgent');
  });
});
