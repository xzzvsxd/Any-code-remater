import { describe, expect, test } from 'vitest';

import { createTerminalEventGate } from '../terminalEventGate';

describe('createTerminalEventGate', () => {
  test('allows only the first terminal event for one execution run', () => {
    const gate = createTerminalEventGate();

    expect(gate.tryStart('complete')).toBe(true);
    expect(gate.tryStart('complete')).toBe(false);
    expect(gate.tryStart('error')).toBe(false);
  });

  test('keeps independent execution runs isolated', () => {
    const firstRun = createTerminalEventGate();
    const secondRun = createTerminalEventGate();

    expect(firstRun.tryStart('error')).toBe(true);
    expect(firstRun.tryStart('complete')).toBe(false);
    expect(secondRun.tryStart('complete')).toBe(true);
  });
});
