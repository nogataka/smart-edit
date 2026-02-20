// test/smart-edit/semantic/semantic_tools.test.ts
import { describe, expect, it } from 'vitest';
import {
  IndexSemanticSymbolsTool,
  SemanticSearchTool,
  FindSimilarCodeTool,
  SemanticSearchStatsTool
} from '../../../src/smart-edit/tools/semantic_tools.js';
import {
  ToolMarkerCanEdit,
  ToolMarkerSymbolicRead,
  ToolMarkerDoesNotRequireActiveProject,
  ToolMarkerOptional
} from '../../../src/smart-edit/tools/tools_base.js';

describe('semantic tools', () => {
  describe('IndexSemanticSymbolsTool', () => {
    it('has CanEdit and Optional markers', () => {
      expect(IndexSemanticSymbolsTool.hasMarker(ToolMarkerCanEdit)).toBe(true);
      expect(IndexSemanticSymbolsTool.hasMarker(ToolMarkerOptional)).toBe(true);
    });
    it('generates correct tool name', () => {
      expect(IndexSemanticSymbolsTool.getNameFromCls()).toBe('index_semantic_symbols');
    });
  });

  describe('SemanticSearchTool', () => {
    it('has SymbolicRead and Optional markers', () => {
      expect(SemanticSearchTool.hasMarker(ToolMarkerSymbolicRead)).toBe(true);
      expect(SemanticSearchTool.hasMarker(ToolMarkerOptional)).toBe(true);
    });
    it('generates correct tool name', () => {
      expect(SemanticSearchTool.getNameFromCls()).toBe('semantic_search');
    });
  });

  describe('FindSimilarCodeTool', () => {
    it('has SymbolicRead and Optional markers', () => {
      expect(FindSimilarCodeTool.hasMarker(ToolMarkerSymbolicRead)).toBe(true);
      expect(FindSimilarCodeTool.hasMarker(ToolMarkerOptional)).toBe(true);
    });
    it('generates correct tool name', () => {
      expect(FindSimilarCodeTool.getNameFromCls()).toBe('find_similar_code');
    });
  });

  describe('SemanticSearchStatsTool', () => {
    it('has DoesNotRequireActiveProject and Optional markers', () => {
      expect(SemanticSearchStatsTool.hasMarker(ToolMarkerDoesNotRequireActiveProject)).toBe(true);
      expect(SemanticSearchStatsTool.hasMarker(ToolMarkerOptional)).toBe(true);
    });
    it('generates correct tool name', () => {
      expect(SemanticSearchStatsTool.getNameFromCls()).toBe('semantic_search_stats');
    });
  });
});
