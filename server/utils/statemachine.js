const { Mutex, MutexValue, MutexCounter } = require('./mutex');

/**
 * A simple state machine implementation with safety checks to prevent invalid states and handlers.
 * The StateMachine class takes an array of states and a corresponding handlers object. Each handler should return the name of the next state.
 * The run() method executes the current state's handler and transitions to the next state based on the handler's return value.
 * If an invalid state or handler is encountered, it resets to the initial state and logs an error.
 * @class StateMachine
 * @typedef {StateMachine}
 */
class StateMachine {
  constructor(states, handlers) {
    if (!Array.isArray(states) || states.length === 0) {
      throw new Error('StateMachine requires a non-empty array of states');
    }

    this.states = states;
    this.handlers = handlers;
    this.state = new MutexValue(0); // protects stateIndex

    // Validate handlers up front
    for (const s of states) {
      if (typeof handlers[s] !== 'function') {
        throw new Error(`Missing handler for state "${s}"`);
      }
    }
  }

  async run() {
    await this.state.update(async (index) => {
      // --- SAFETY 1: clamp invalid index ---
      if (index < 0 || index >= this.states.length) {
        console.warn(`Invalid stateIndex=${index}, resetting to 0`);
        index = 0;
      }

      const stateName = this.states[index];
      const handler = this.handlers[stateName];

      // --- SAFETY 2: handler must exist ---
      if (!handler) {
        console.error(`No handler for state "${stateName}", resetting`);
        return 0;
      }

      // Run handler (may be async)
      const nextStateName = await handler();

      // --- SAFETY 3: next state must be valid ---
      const nextIndex = this.states.indexOf(nextStateName);
      if (nextIndex === -1) {
        console.error(`Invalid next state "${nextStateName}", resetting`);
        return 0;
      }

      return nextIndex;
    });
  }

  async currentState() {
    const index = await this.state.get();
    if (index < 0 || index >= this.states.length) {
      console.warn(`Invalid stateIndex=${index} in currentState(), resetting to 0`);
      await this.state.update(() => 0);
      return this.states[0];
    }

    return this.states[index];
  }

  reset() {
    return this.state.update(() => 0);
  }
}

module.exports = { StateMachine };
