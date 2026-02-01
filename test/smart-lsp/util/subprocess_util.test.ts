import { describe, expect, it } from 'vitest';

import {
  defaultSubprocessOptions,
  ensureDefaultSubprocessOptions
} from '../../../src/smart-lsp/util/subprocess_util.js';

describe('defaultSubprocessOptions', () => {
  it('returns windowsHide=true on Windows', () => {
    expect(defaultSubprocessOptions('win32')).toEqual({ windowsHide: true });
  });

  it('returns empty options on Unix-like platforms', () => {
    expect(defaultSubprocessOptions('linux')).toEqual({});
    expect(defaultSubprocessOptions('darwin')).toEqual({});
  });
});

describe('ensureDefaultSubprocessOptions', () => {
  it('adds windowsHide when not provided on Windows', () => {
    const options = ensureDefaultSubprocessOptions({ shell: true }, 'win32');
    expect(options.windowsHide).toBe(true);
  });

  it('does not override existing windowsHide configuration', () => {
    const options = ensureDefaultSubprocessOptions({ windowsHide: false }, 'win32');
    expect(options.windowsHide).toBe(false);
  });

  it('does not mutate options on non-Windows platforms', () => {
    const options = ensureDefaultSubprocessOptions({ shell: false }, 'linux');
    expect(options.windowsHide).toBeUndefined();
  });
});
