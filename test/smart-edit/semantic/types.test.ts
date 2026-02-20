// test/smart-edit/semantic/types.test.ts
import { describe, expect, it } from 'vitest';
import {
  INDEXABLE_SYMBOL_KINDS,
  MAX_BODY_TEXT_LENGTH,
  EMBEDDING_BATCH_SIZE,
  PARALLEL_BATCHES
} from '../../../src/smart-edit/semantic/types.js';

describe('semantic types', () => {
  it('INDEXABLE_SYMBOL_KINDS contains expected kinds', () => {
    expect(INDEXABLE_SYMBOL_KINDS.has('Function')).toBe(true);
    expect(INDEXABLE_SYMBOL_KINDS.has('Class')).toBe(true);
    expect(INDEXABLE_SYMBOL_KINDS.has('Method')).toBe(true);
    expect(INDEXABLE_SYMBOL_KINDS.has('Variable')).toBe(false);
  });

  it('constants have expected values', () => {
    expect(MAX_BODY_TEXT_LENGTH).toBe(2000);
    expect(EMBEDDING_BATCH_SIZE).toBe(100);
    expect(PARALLEL_BATCHES).toBe(3);
  });
});
