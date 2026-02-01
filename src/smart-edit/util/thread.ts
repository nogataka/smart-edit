export class TimeoutException extends Error {
  readonly timeoutSeconds: number;

  constructor(message: string, timeoutSeconds: number) {
    super(message);
    this.name = 'TimeoutException';
    this.timeoutSeconds = timeoutSeconds;
  }
}

export enum ExecutionStatus {
  Success = 'success',
  Timeout = 'timeout',
  Exception = 'error'
}

export class ExecutionResult<T> {
  resultValue: T | undefined;
  status: ExecutionStatus | undefined;
  exception: Error | undefined;

  setResultValue(value: T): void {
    this.resultValue = value;
    this.status = ExecutionStatus.Success;
  }

  setTimedOut(exception: TimeoutException): void {
    this.exception = exception;
    this.status = ExecutionStatus.Timeout;
  }

  setException(exception: Error): void {
    this.exception = exception;
    this.status = ExecutionStatus.Exception;
  }

  toString(): string {
    const parts = [
      `status=${this.status ?? 'unknown'}`,
      `result=${this.resultValue !== undefined ? 'set' : 'unset'}`,
      `exception=${this.exception ? this.exception.message : 'none'}`
    ];
    return `ExecutionResult(${parts.join(', ')})`;
  }
}

export interface ExecuteWithTimeoutOptions {
  timeoutSeconds: number;
  functionName: string;
}

export async function executeWithTimeout<T>(
  func: () => T | Promise<T>,
  { timeoutSeconds, functionName }: ExecuteWithTimeoutOptions
): Promise<ExecutionResult<T>> {
  const executionResult = new ExecutionResult<T>();
  const timeout = Math.max(0, timeoutSeconds);
  const timeoutException = new TimeoutException(
    `Execution of '${functionName}' timed out after ${timeout} seconds.`,
    timeout
  );

  let timeoutHandle: NodeJS.Timeout | undefined;
  let didTimeout = false;

  const timeoutPromise = (async () => {
    await new Promise<void>((resolve) => {
      timeoutHandle = setNodeTimeout(resolve, timeout * 1000);
      timeoutHandle.unref?.();
    });
    didTimeout = true;
    throw timeoutException;
  })();

  let operationPromise: Promise<T>;
  try {
    operationPromise = Promise.resolve(func());
  } catch (error) {
    operationPromise = Promise.reject(normalizeToError(error));
  }

  try {
    const value = await Promise.race([operationPromise, timeoutPromise]);
    if (!didTimeout) {
      executionResult.setResultValue(value);
    }
  } catch (error) {
    if (error === timeoutException) {
      executionResult.setTimedOut(timeoutException);
    } else {
      executionResult.setException(normalizeToError(error));
    }
  } finally {
    if (timeoutHandle) {
      clearNodeTimeout(timeoutHandle);
    }
  }

  return executionResult;
}

function normalizeToError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(String(value));
}
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';
