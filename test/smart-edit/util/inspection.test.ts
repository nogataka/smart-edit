import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearLanguageRegistry,
  clearSubclassRegistry,
  determineProgrammingLanguageComposition,
  iterSubclasses,
  registerLanguageDefinition,
  registerSubclass
} from '../../../src/smart-edit/util/inspection.js';

describe('registerSubclass / iterSubclasses', () => {
  afterEach(() => {
    clearSubclassRegistry();
  });

  it('collects direct and nested subclasses recursively', () => {
    abstract class Tool {}
    class BaseTool extends Tool {}
    class DerivedTool extends BaseTool {}

    registerSubclass(BaseTool);
    registerSubclass(DerivedTool);

    expect(Array.from(iterSubclasses(Tool))).toEqual([BaseTool, DerivedTool]);
  });

  it('returns only direct subclasses when recursive=false', () => {
    abstract class Tool {}
    class ShellTool extends Tool {}
    class BashTool extends ShellTool {}

    registerSubclass(ShellTool);
    registerSubclass(BashTool);

    expect(Array.from(iterSubclasses(Tool, false))).toEqual([ShellTool]);
  });

  it('deduplicates when the same subclass is registered multiple times', () => {
    abstract class Tool {}
    class GitTool extends Tool {}

    registerSubclass(GitTool);
    registerSubclass(GitTool);

    expect(Array.from(iterSubclasses(Tool))).toEqual([GitTool]);
  });
});

describe('determineProgrammingLanguageComposition', () => {
  afterEach(() => {
    clearLanguageRegistry();
  });

  it('calculates percentages for provided languages', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-inspection-'));

    try {
      fs.writeFileSync(path.join(tempDir, 'main.py'), '');
      fs.writeFileSync(path.join(tempDir, 'component.ts'), '');
      fs.writeFileSync(path.join(tempDir, 'script.sh'), '');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '');

      const languages = [
        {
          name: 'python',
          matcher: { isRelevantFilename: (filename: string) => filename.endsWith('.py') }
        },
        {
          name: 'typescript',
          matcher: { isRelevantFilename: (filename: string) => filename.endsWith('.ts') }
        },
        {
          name: 'shell',
          matcher: { isRelevantFilename: (filename: string) => filename.endsWith('.sh') }
        }
      ];

      const result = determineProgrammingLanguageComposition(tempDir, { languages });

      expect(result.python).toBe(25);
      expect(result.typescript).toBe(25);
      expect(result.shell).toBe(25);
      expect(result).not.toHaveProperty('markdown');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses registered languages and respects the includeExperimental flag', () => {
    registerLanguageDefinition({
      name: 'python',
      matcher: { isRelevantFilename: (filename: string) => filename.endsWith('.py') }
    });
    registerLanguageDefinition({
      name: 'ruby',
      matcher: { isRelevantFilename: (filename: string) => filename.endsWith('.rb') },
      experimental: true
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-inspection-'));

    try {
      fs.writeFileSync(path.join(tempDir, 'app.py'), '');
      fs.writeFileSync(path.join(tempDir, 'worker.rb'), '');

      const withoutExperimental = determineProgrammingLanguageComposition(tempDir);
      expect(withoutExperimental).toEqual({ python: 50 });

      const withExperimental = determineProgrammingLanguageComposition(tempDir, {
        includeExperimental: true
      });
      expect(withExperimental).toEqual({ python: 50, ruby: 50 });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('supports SmartLanguage-like inputs', () => {
    class MockMatcher {
      isRelevantFilename(filename: string): boolean {
        return filename.endsWith('.py');
      }
    }

    class MockLanguage {
      toString(): string {
        return 'python';
      }

      isExperimental(): boolean {
        return false;
      }

      getSourceFnMatcher(): MockMatcher {
        return new MockMatcher();
      }
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-inspection-'));

    try {
      fs.writeFileSync(path.join(tempDir, 'main.py'), '');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '');

      const result = determineProgrammingLanguageComposition(tempDir, {
        languages: [new MockLanguage()]
      });

      expect(result).toEqual({ python: 50 });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

