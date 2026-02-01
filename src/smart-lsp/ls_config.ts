export enum Language {
  CSHARP = 'csharp',
  PYTHON = 'python',
  RUST = 'rust',
  JAVA = 'java',
  KOTLIN = 'kotlin',
  TYPESCRIPT = 'typescript',
  GO = 'go',
  RUBY = 'ruby',
  DART = 'dart',
  CPP = 'cpp',
  PHP = 'php',
  R = 'r',
  CLOJURE = 'clojure',
  ELIXIR = 'elixir',
  TERRAFORM = 'terraform',
  SWIFT = 'swift',
  BASH = 'bash',
  ZIG = 'zig',
  LUA = 'lua',
  NIX = 'nix',
  ERLANG = 'erlang',
  AL = 'al',
  TYPESCRIPT_VTS = 'typescript_vts',
  PYTHON_JEDI = 'python_jedi',
  CSHARP_OMNISHARP = 'csharp_omnisharp',
  RUBY_SOLARGRAPH = 'ruby_solargraph'
}

const EXPERIMENTAL_LANGUAGES = new Set<Language>([
  Language.TYPESCRIPT_VTS,
  Language.PYTHON_JEDI,
  Language.CSHARP_OMNISHARP,
  Language.RUBY_SOLARGRAPH
]);

const LANGUAGE_LOOKUP = new Map<string, Language>(
  Object.values(Language).map((value) => [value.toLowerCase(), value as Language])
);

export interface ListLanguagesOptions {
  includeExperimental?: boolean;
}

export function listLanguages(options?: ListLanguagesOptions): Language[] {
  const includeExperimental = options?.includeExperimental ?? false;
  return Object.values(Language).filter((lang) => includeExperimental || !EXPERIMENTAL_LANGUAGES.has(lang));
}

export function isExperimentalLanguage(language: Language): boolean {
  return EXPERIMENTAL_LANGUAGES.has(language);
}

export function coerceLanguage(value: string): Language {
  const normalized = value.toLowerCase();
  const found = LANGUAGE_LOOKUP.get(normalized);
  if (!found) {
    const valid = Array.from(LANGUAGE_LOOKUP.keys()).sort().join(', ');
    throw new RangeError(`Unsupported language "${value}". 有効な値: ${valid}`);
  }

  return found;
}

const CASE_INSENSITIVE = process.platform === 'win32';

type FilenameMatcherFn = (filename: string) => boolean;

function globToRegExp(pattern: string): RegExp {
  let regex = '';

  for (const char of pattern) {
    if (char === '*') {
      regex += '.*';
    } else if (char === '?') {
      regex += '.';
    } else if ('\\[]{}()+-.^$|'.includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }

  return new RegExp(`^${regex}$`, CASE_INSENSITIVE ? 'i' : undefined);
}

function createMatcher(patterns: string[]): FilenameMatcherFn {
  if (patterns.length === 0) {
    return () => true;
  }

  const regexes = patterns.map((pattern) => globToRegExp(pattern));
  return (filename: string): boolean => regexes.some((regex) => regex.test(filename));
}

function getPatternsForLanguage(language: Language): string[] {
  switch (language) {
    case Language.PYTHON:
    case Language.PYTHON_JEDI:
      return ['*.py', '*.pyi'];
    case Language.JAVA:
      return ['*.java'];
    case Language.TYPESCRIPT:
    case Language.TYPESCRIPT_VTS: {
      const patterns: string[] = [];
      for (const prefix of ['c', 'm', '']) {
        for (const postfix of ['x', '']) {
          for (const base of ['ts', 'js']) {
            patterns.push(`*.${prefix}${base}${postfix}`);
          }
        }
      }
      return patterns;
    }
    case Language.CSHARP:
    case Language.CSHARP_OMNISHARP:
      return ['*.cs'];
    case Language.RUST:
      return ['*.rs'];
    case Language.GO:
      return ['*.go'];
    case Language.RUBY:
      return ['*.rb', '*.erb'];
    case Language.RUBY_SOLARGRAPH:
      return ['*.rb'];
    case Language.CPP:
      return ['*.cpp', '*.h', '*.hpp', '*.c', '*.hxx', '*.cc', '*.cxx'];
    case Language.KOTLIN:
      return ['*.kt', '*.kts'];
    case Language.DART:
      return ['*.dart'];
    case Language.PHP:
      return ['*.php'];
    case Language.R:
      return ['*.R', '*.r', '*.Rmd', '*.Rnw'];
    case Language.CLOJURE:
      return ['*.clj', '*.cljs', '*.cljc', '*.edn'];
    case Language.ELIXIR:
      return ['*.ex', '*.exs'];
    case Language.TERRAFORM:
      return ['*.tf', '*.tfvars', '*.tfstate'];
    case Language.SWIFT:
      return ['*.swift'];
    case Language.BASH:
      return ['*.sh', '*.bash'];
    case Language.ZIG:
      return ['*.zig', '*.zon'];
    case Language.LUA:
      return ['*.lua'];
    case Language.NIX:
      return ['*.nix'];
    case Language.ERLANG:
      return ['*.erl', '*.hrl', '*.escript', '*.config', '*.app', '*.app.src'];
    case Language.AL:
      return ['*.al', '*.dal'];
    default:
      return [];
  }
}

export interface FilenameMatcherLike {
  isRelevantFilename(filename: string): boolean;
}

export function getLanguageFilenameMatcher(language: Language): FilenameMatcherLike {
  const patterns = getPatternsForLanguage(language);
  if (!patterns.length) {
    throw new RangeError(`Unhandled language '${language}' for filename matcher`);
  }
  const matcher = createMatcher(patterns);
  return {
    isRelevantFilename: (filename: string) => matcher(filename)
  };
}
