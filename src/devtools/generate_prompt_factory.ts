import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { autogeneratePromptFactoryModule } from '../interprompt/prompt_factory.js';
import {
  PROMPT_TEMPLATES_DIR_INTERNAL,
  REPO_ROOT
} from '../smart-edit/constants.js';
import { createSmartEditLogger } from '../smart-edit/util/logging.js';

export interface GeneratePromptFactoryOptions {
  promptsDir?: string | string[];
  targetPath?: string;
}

const { logger } = createSmartEditLogger({ name: 'devtools.generate_prompt_factory' });

function resolveTargetPath(targetPath?: string): string {
  if (targetPath) {
    return path.resolve(targetPath);
  }
  return path.join(REPO_ROOT, 'src', 'smart-edit', 'generated', 'generated_prompt_factory.ts');
}

function resolvePromptsDir(promptsDir?: string | string[]): string | string[] {
  if (promptsDir === undefined) {
    return PROMPT_TEMPLATES_DIR_INTERNAL;
  }
  if (Array.isArray(promptsDir)) {
    return promptsDir.map((dir) => path.resolve(dir));
  }
  return path.resolve(promptsDir);
}

export function generatePromptFactory(
  options: GeneratePromptFactoryOptions = {}
): string {
  const promptsDir = resolvePromptsDir(options.promptsDir);
  const targetPath = resolveTargetPath(options.targetPath);

  autogeneratePromptFactoryModule(promptsDir, targetPath);
  logger.info('Prompt factory generated', {
    promptsDir,
    targetPath
  });

  return targetPath;
}

interface CliArguments {
  promptsDir?: string | string[];
  targetPath?: string;
  showHelp?: boolean;
}

function parseCliArguments(argv: string[]): CliArguments {
  const result: CliArguments = {};
  const promptsDirs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--prompts-dir':
      case '-p': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('Missing value for --prompts-dir option');
        }
        promptsDirs.push(value);
        index += 1;
        break;
      }
      case '--target':
      case '-t': {
        const value = argv[index + 1];
        if (!value) {
          throw new Error('Missing value for --target option');
        }
        result.targetPath = value;
        index += 1;
        break;
      }
      case '--help':
      case '-h': {
        result.showHelp = true;
        break;
      }
      default: {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  }

  if (promptsDirs.length === 1) {
    result.promptsDir = promptsDirs[0];
  } else if (promptsDirs.length > 1) {
    result.promptsDir = promptsDirs;
  }

  return result;
}

function printHelp(): void {
  const relativeTarget = path.relative(
    REPO_ROOT,
    path.join(REPO_ROOT, 'src', 'smart-edit', 'generated', 'generated_prompt_factory.ts')
  );
  logger.info(
    [
      'Usage: pnpm prompts:generate [options]',
      '',
      'Options:',
      '  -p, --prompts-dir <path>   生成に使用するプロンプトテンプレートのディレクトリを追加（複数指定可）',
      '  -t, --target <path>        出力先モジュールのパスを明示的に指定',
      '  -h, --help                 このヘルプを表示',
      '',
      `既定値: promptsDir=${PROMPT_TEMPLATES_DIR_INTERNAL}, target=${relativeTarget}`
    ].join('\n')
  );
}

function isExecutedAsMainModule(metaUrl: string): boolean {
  const currentFilePath = fileURLToPath(metaUrl);
  const entryFile = process.argv[1];
  if (!entryFile) {
    return false;
  }
  return path.resolve(entryFile) === currentFilePath;
}

if (isExecutedAsMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    const parsed = parseCliArguments(argv);
    if (parsed.showHelp) {
      printHelp();
      process.exit(0);
    }
    generatePromptFactory({
      promptsDir: parsed.promptsDir,
      targetPath: parsed.targetPath
    });
  } catch (error) {
    logger.error('Failed to generate prompt factory', error);
    process.exit(1);
  }
}
