import { describe, it, expect } from 'vitest';

import { LanguageServerSymbol } from '../../../src/smart-edit/symbol.js';

interface MatchCase {
  readonly pattern: string;
  readonly namePathParts: string[];
  readonly substring: boolean;
  readonly expected: boolean;
}

const MATCH_CASES: MatchCase[] = [
  { pattern: 'foo', namePathParts: ['foo'], substring: false, expected: true },
  { pattern: 'foo', namePathParts: ['bar', 'foo'], substring: false, expected: true },
  { pattern: 'foo', namePathParts: ['foobar'], substring: false, expected: false },
  { pattern: '/foo', namePathParts: ['foo'], substring: false, expected: true },
  { pattern: '/foo', namePathParts: ['bar', 'foo'], substring: false, expected: false },
  { pattern: 'foo', namePathParts: ['foobar'], substring: true, expected: true },
  { pattern: 'foo', namePathParts: ['bar', 'bazfoo'], substring: true, expected: true },
  { pattern: 'foo', namePathParts: ['bar', 'baz'], substring: true, expected: false },
  { pattern: '/bar/foo', namePathParts: ['bar', 'foo'], substring: false, expected: true },
  { pattern: '/bar/foo', namePathParts: ['bar', 'baz'], substring: false, expected: false },
  { pattern: '/bar/foo', namePathParts: ['bar', 'foobar'], substring: true, expected: true },
  { pattern: 'bar/foo', namePathParts: ['bar', 'foo'], substring: false, expected: true },
  { pattern: 'bar/foo', namePathParts: ['nested', 'bar', 'foo'], substring: false, expected: true },
  { pattern: 'bar/foo', namePathParts: ['bar', 'baz'], substring: false, expected: false },
  { pattern: 'bar/foo', namePathParts: ['bar', 'bazfoo'], substring: true, expected: true },
  { pattern: 'bar/foo', namePathParts: ['baz', 'foo'], substring: true, expected: false }
];

describe('LanguageServerSymbol.matchNamePath', () => {
  for (const scenario of MATCH_CASES) {
    const { pattern, namePathParts, substring, expected } = scenario;
    const label = `pattern=${pattern}, path=${namePathParts.join('/')}, substring=${substring}`;
    it(label, () => {
      const actual = LanguageServerSymbol.matchNamePath(pattern, namePathParts, substring);
      expect(actual).toBe(expected);
    });
  }
});
