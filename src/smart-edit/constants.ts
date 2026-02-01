import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..', '..');
const smartEditPackageRoot = path.resolve(__dirname);
const smartEditManagedDirName = '.smart-edit';
const smartEditManagedDirInHome = path.join(os.homedir(), smartEditManagedDirName);

export const SMART_EDIT_MANAGED_DIR_NAME = smartEditManagedDirName;
export const SMART_EDIT_MANAGED_DIR_IN_HOME = smartEditManagedDirInHome;

export const REPO_ROOT = repoRoot;
export const PROMPT_TEMPLATES_DIR_INTERNAL = path.join(
  smartEditPackageRoot,
  'resources',
  'config',
  'prompt_templates'
);
export const PROMPT_TEMPLATES_DIR_IN_USER_HOME = path.join(
  smartEditManagedDirInHome,
  'prompt_templates'
);
export const SMART_EDITS_OWN_CONTEXT_YAMLS_DIR = path.join(
  smartEditPackageRoot,
  'resources',
  'config',
  'contexts'
);
export const USER_CONTEXT_YAMLS_DIR = path.join(smartEditManagedDirInHome, 'contexts');
export const SMART_EDITS_OWN_MODE_YAMLS_DIR = path.join(
  smartEditPackageRoot,
  'resources',
  'config',
  'modes'
);
export const USER_MODE_YAMLS_DIR = path.join(smartEditManagedDirInHome, 'modes');
export const INTERNAL_MODE_YAMLS_DIR = path.join(
  smartEditPackageRoot,
  'resources',
  'config',
  'internal_modes'
);
export const SMART_EDIT_DASHBOARD_DIR = path.join(smartEditPackageRoot, 'resources', 'dashboard');
export const SMART_EDIT_ICON_DIR = path.join(smartEditPackageRoot, 'resources', 'icons');

export const DEFAULT_ENCODING = 'utf-8';
export const DEFAULT_CONTEXT = 'desktop-app';
export const DEFAULT_MODES = ['interactive', 'editing'] as const;

export const PROJECT_TEMPLATE_FILE = path.join(
  smartEditPackageRoot,
  'resources',
  'project.template.yml'
);
export const SMART_EDIT_CONFIG_TEMPLATE_FILE = path.join(
  smartEditPackageRoot,
  'resources',
  'smart_edit_config.template.yml'
);

export const SMART_EDIT_LOG_FORMAT =
  '%(levelname)-5s %(asctime)-15s [%(threadName)s] %(name)s:%(funcName)s:%(lineno)d - %(message)s';
