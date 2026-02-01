import { describe, expect, it, vi } from 'vitest';

import { evaluateHeadlessEnvironment } from '../../../src/smart-edit/util/exception.js';

describe('evaluateHeadlessEnvironment', () => {
  const baseEnv: NodeJS.ProcessEnv = {
    DISPLAY: ':0',
    SSH_CONNECTION: '',
    SSH_CLIENT: '',
    CI: '',
    CONTAINER: ''
  };

  it('returns false on Windows even without DISPLAY', () => {
    const env = { ...baseEnv, DISPLAY: undefined };
    const result = evaluateHeadlessEnvironment(env, 'win32', '10.0.0', vi.fn().mockReturnValue(false));
    expect(result).toBe(false);
  });

  it('returns true when DISPLAY is missing on Unix-like systems', () => {
    const env = { ...baseEnv, DISPLAY: undefined };
    const result = evaluateHeadlessEnvironment(env, 'linux', '6.8.0', vi.fn().mockReturnValue(false));
    expect(result).toBe(true);
  });

  it('returns true when running inside SSH session', () => {
    const env = { ...baseEnv, SSH_CONNECTION: 'user 1 2 3' };
    const result = evaluateHeadlessEnvironment(env, 'linux', '6.8.0', vi.fn().mockReturnValue(false));
    expect(result).toBe(true);
  });

  it('returns true when container markers are present', () => {
    const env = { ...baseEnv, CI: 'true' };
    const fileExists = vi.fn().mockReturnValue(false);
    const result = evaluateHeadlessEnvironment(env, 'linux', '6.8.0', fileExists);
    expect(result).toBe(true);
  });

  it('returns true when /.dockerenv exists', () => {
    const fileExists = vi.fn().mockImplementation((path: string) => path === '/.dockerenv');
    const result = evaluateHeadlessEnvironment(baseEnv, 'linux', '6.8.0', fileExists);
    expect(result).toBe(true);
  });

  it('returns true for WSL environments', () => {
    const result = evaluateHeadlessEnvironment(baseEnv, 'linux', '6.8.0-microsoft-standard', vi.fn().mockReturnValue(false));
    expect(result).toBe(true);
  });

  it('returns false for typical desktop Linux environment', () => {
    const result = evaluateHeadlessEnvironment(baseEnv, 'linux', '6.8.0', vi.fn().mockReturnValue(false));
    expect(result).toBe(false);
  });
});
