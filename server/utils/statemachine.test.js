import { describe, expect, it } from 'vitest';
import { StateMachine } from './statemachine.js';

describe('StateMachine', () => {
  const states = ['A', 'B', 'C'];
  const handlers = {
    A: () => 'B',
    B: () => 'C',
    C: () => 'C',
  };

  it('should initialize with valid states and handlers', () => {
    const sm = new StateMachine(states, handlers);
    expect(sm).toBeInstanceOf(StateMachine);
  });

  it('should iterate through states correctly', async () => {
    const sm = new StateMachine(states, handlers);
    expect(await sm.currentState()).toBe('A');
    await sm.run();
    expect(await sm.currentState()).toBe('B');
    await sm.run();
    expect(await sm.currentState()).toBe('C');
    await sm.run();
    expect(await sm.currentState()).toBe('C'); // stays in C
  });

  it('should reset to initial state', async () => {
    const sm = new StateMachine(states, handlers);
    await sm.run();
    await sm.run();
    expect(await sm.currentState()).toBe('C');
    await sm.reset();
    expect(await sm.currentState()).toBe('A');
  });
});

describe('StateMachine with invalid inputs', () => {
  it('should throw if states array is empty', () => {
    expect(() => new StateMachine([], {})).toThrow();
  });

  it('should throw if handler is missing for a state', () => {
    expect(() => new StateMachine(['A'], {})).toThrow();
  });

  it('should gracefully reset if invalid state index is provided', async () => {
    const sm = new StateMachine(['A'], { A: () => 'B' });
    sm.run();
    expect(await sm.currentState()).toBe('A'); // should reset to 'A'
  });

  {
    const states = ['A', 'B', 'C'];
    const handlers = {
      A: () => 'B',
      B: () => 'C',
      C: () => 'C',
    };

    it('should recover from forcible invalid index in run()', async () => {
      const sm = new StateMachine(['A'], { A: () => 'A' });
      await sm.state.update(() => -1); // force invalid index
      await sm.run();
      expect(await sm.currentState()).toBe('A');
    });

    it('should gracefully reset if invalid index is provided', async () => {
      const sm = new StateMachine(['A', 'B'], { A: () => 'B', B: () => 'B' });
      await sm.run();
      expect(await sm.currentState()).toBe('B');
      await sm.state.update(() => -1); // force invalid index
      expect(await sm.currentState()).toBe('A'); // should reset to 'A'
    });

    {
      const states = ['A'];
      const handlers = { A: () => 'A' };
      it('should gracefully cope with missing handler', async () => {
        const sm = new StateMachine(states, handlers);
        handlers.A = null; // force missing handler
        await sm.run();
        expect(await sm.currentState()).toBe('A'); // should reset to 'A'
      });
    }
  }
});
