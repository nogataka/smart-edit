import { setTimeout as setNodeTimeout } from 'node:timers';

import { describe, expect, it } from 'vitest';

import {
  executeWithTimeout,
  ExecutionStatus,
  TimeoutException
} from '../../../src/smart-edit/util/thread.js';

describe('executeWithTimeout', () => {
  it('resolves successfully when the function finishes before the timeout', async () => {
    const result = await executeWithTimeout(
      async () => {
        await delay(10);
        return 42;
      },
      { timeoutSeconds: 0.5, functionName: 'fastTask' }
    );

    expect(result.status).toBe(ExecutionStatus.Success);
    expect(result.resultValue).toBe(42);
    expect(result.exception).toBeUndefined();
  });

  it('captures thrown exceptions from the function', async () => {
    const result = await executeWithTimeout(
      () => {
        throw new Error('boom');
      },
      { timeoutSeconds: 0.5, functionName: 'failingTask' }
    );

    expect(result.status).toBe(ExecutionStatus.Exception);
    expect(result.resultValue).toBeUndefined();
    expect(result.exception).toBeInstanceOf(Error);
    expect(result.exception?.message).toBe('boom');
  });

  it('marks the result as timed out when exceeding the timeout', async () => {
    const result = await executeWithTimeout(
      async () => {
        await delay(50);
        return 'slow';
      },
      { timeoutSeconds: 0.01, functionName: 'slowTask' }
    );

    expect(result.status).toBe(ExecutionStatus.Timeout);
    expect(result.resultValue).toBeUndefined();
    expect(result.exception).toBeInstanceOf(TimeoutException);

    const timeoutError = result.exception as TimeoutException;
    expect(timeoutError.timeoutSeconds).toBeCloseTo(0.01);
    expect(timeoutError.message).toContain('slowTask');
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setNodeTimeout(resolve, ms);
  });
}
