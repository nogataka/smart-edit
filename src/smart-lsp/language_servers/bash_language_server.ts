import fs from 'node:fs';
import path from 'node:path';

import { createSmartEditLogger, type LogLevel } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import {
  SmartLanguageServer,
  SmartLspSettings,
  type LanguageServerConfigLike,
  type SmartLspSettingsInit,
  type SmartLanguageServerConstructor,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';
import { type ProcessLaunchInfo } from '../lsp_protocol_handler/server.js';

import { Platform, RuntimeDependencyCollection, quoteWindowsPath } from './common.js';

function resolveRuntimeDirectory(settings: SmartLspSettings): string {
  return path.join(settings.languageServersStaticDir, 'BashLanguageServer');
}

function ensureDependencies(settings: SmartLspSettings): string {
  const runtimeDir = resolveRuntimeDirectory(settings);
  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    return runtimeDir;
  }

  const dependencies = new RuntimeDependencyCollection([
    {
      id: 'bash-language-server',
      description: 'bash-language-server npm package',
      command: ['npm', 'install', '--prefix', './', 'bash-language-server@5.6.0'],
      platformId: 'any'
    }
  ]);

  const { logger } = createSmartEditLogger({
    emitToConsole: false,
    name: 'smart-lsp.language_servers.bash'
  });

  try {
    dependencies.install(logger, runtimeDir);
  } catch (error) {
    logger.warn(
      `npm install for bash-language-server failed (${String(error)}). Falling back to system binary if available.`
    );
  }

  return runtimeDir;
}

function determineCommand(settings: SmartLspSettings): ProcessLaunchInfo {
  const runtimeDir = ensureDependencies(settings);
  const binName = Platform.isWindows() ? 'bash-language-server.cmd' : 'bash-language-server';
  const localBinary = path.join(runtimeDir, 'node_modules', '.bin', binName);

  if (fs.existsSync(localBinary)) {
    return {
      cmd: `${quoteWindowsPath(localBinary)} start`
    };
  }

  return {
    cmd: 'bash-language-server start'
  };
}

export class BashLanguageServer extends SmartLanguageServer {
  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: {
      timeout?: number | null;
      smartLspSettings?: SmartLspSettingsInit;
    } = {}
  ) {
    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const launchInfo = determineCommand(solidSettings);
    const handler = new NodeLanguageServerHandler({
      ...launchInfo,
      cwd: repositoryRootPath
    });

    super(config, loggerLike, repositoryRootPath, {
      ...options,
      smartLspSettings: options?.smartLspSettings,
      handler
    });
  }
}

registerLanguageServer(Language.BASH, BashLanguageServer as SmartLanguageServerConstructor);
