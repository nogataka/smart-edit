import nunjucks from 'nunjucks';

const KEYWORDS = new Set([
  'and',
  'as',
  'block',
  'caller',
  'call',
  'do',
  'else',
  'elseif',
  'endblock',
  'endfor',
  'endif',
  'extends',
  'filter',
  'for',
  'from',
  'if',
  'import',
  'in',
  'include',
  'is',
  'macro',
  'not',
  'or',
  'recursive',
  'set',
  'true',
  'false',
  'none',
  'with'
]);

const BUILTIN_IDENTIFIERS = new Set(['loop', 'range', 'cycler', 'joiner', 'namespace', 'super']);

type IdentifierSet = Set<string>;

function stripStringLiterals(expression: string): string {
  return expression.replace(/(['"]).*?(?<!\\)\1/gs, ' ');
}

function normalizeIdentifier(token: string): string | null {
  if (token.length === 0) {
    return null;
  }
  if (/^\d/.test(token)) {
    return null;
  }
  const base = token.split('.')[0] ?? token;
  if (KEYWORDS.has(base) || BUILTIN_IDENTIFIERS.has(base)) {
    return null;
  }
  return base;
}

function collectIdentifiersFromExpression(expression: string, defined: IdentifierSet[], sink: IdentifierSet): void {
  const sanitized = stripStringLiterals(expression);
  const tokens = sanitized.split(/[^A-Za-z0-9_.]+/).map((token) => token.trim()).filter(Boolean);
  for (const token of tokens) {
    const normalized = normalizeIdentifier(token);
    if (!normalized) {
      continue;
    }
    if (isIdentifierDefined(normalized, defined)) {
      continue;
    }
    sink.add(normalized);
  }
}

function isIdentifierDefined(identifier: string, scopes: IdentifierSet[]): boolean {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    if (scopes[index]?.has(identifier) === true) {
      return true;
    }
  }
  return false;
}

function addIdentifiersToCurrentScope(text: string, scopes: IdentifierSet[]): void {
  const scope = scopes[scopes.length - 1];
  if (!scope) {
    return;
  }
  const sanitized = stripStringLiterals(text);
  const tokens = sanitized.split(/[^A-Za-z0-9_.]+/).map((token) => token.trim()).filter(Boolean);
  for (const token of tokens) {
    const normalized = normalizeIdentifier(token);
    if (!normalized) {
      continue;
    }
    scope.add(normalized);
  }
}

function analyseStatement(statement: string, scopes: IdentifierSet[], sink: IdentifierSet): void {
  const trimmed = statement.trim();
  if (!trimmed) {
    return;
  }
  if (trimmed.startsWith('for ')) {
    const match = /^for\s+(.+?)\s+in\s+(.+?)$/s.exec(trimmed);
    if (match) {
      const targetSection = match[1] ?? '';
      const expression = match[2] ?? '';
      const loopScope = new Set<string>();
      const targets = targetSection.split(',').map((item) => item.trim()).filter(Boolean);
      for (const target of targets) {
        const normalized = normalizeIdentifier(target);
        if (normalized) {
          loopScope.add(normalized);
        }
      }
      scopes.push(loopScope);
      collectIdentifiersFromExpression(expression, scopes, sink);
      return;
    }
  }
  if (trimmed.startsWith('endfor')) {
    if (scopes.length > 1) {
      scopes.pop();
    }
    return;
  }
  if (trimmed.startsWith('set ')) {
    const match = /^set\s+(.+?)=(.+)$/s.exec(trimmed);
    if (match) {
      const targetSection = match[1] ?? '';
      addIdentifiersToCurrentScope(targetSection, scopes);
      const expression = match[2] ?? '';
      collectIdentifiersFromExpression(expression, scopes, sink);
      return;
    }
  }
  collectIdentifiersFromExpression(trimmed, scopes, sink);
}

function collectTemplateParameters(templateString: string): string[] {
  const sink: IdentifierSet = new Set();
  const scopes: IdentifierSet[] = [new Set(BUILTIN_IDENTIFIERS)];
  const tagPattern = /({%[\s\S]*?%}|{{[\s\S]*?}})/g;

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(templateString)) !== null) {
    const token = match[0] ?? '';
    if (token.startsWith('{{')) {
      const expression = token.slice(2, -2);
      collectIdentifiersFromExpression(expression, scopes, sink);
      continue;
    }
    if (token.startsWith('{%')) {
      const statement = token.slice(2, -2);
      analyseStatement(statement, scopes, sink);
    }
  }

  return Array.from(sink).sort();
}

class JinjaEnvProvider {
  private static instance: nunjucks.Environment | null = null;

  static getEnv(): nunjucks.Environment {
    this.instance ??= new nunjucks.Environment(undefined, {
      autoescape: false,
      throwOnUndefined: false,
      trimBlocks: false,
      lstripBlocks: false
    });
    return this.instance;
  }
}

export interface ParameterizedTemplateInterface {
  getParameters(): string[];
}

export class JinjaTemplate implements ParameterizedTemplateInterface {
  private readonly template: nunjucks.Template;
  private readonly parameters: string[];

  constructor(templateString: string) {
    const normalized = templateString.trim();
    const env = JinjaEnvProvider.getEnv();
    this.template = new nunjucks.Template(normalized, env, undefined, true);
    this.parameters = collectTemplateParameters(normalized);
  }

  render(params: Record<string, unknown>): string {
    return this.template.render(params);
  }

  getParameters(): string[] {
    return [...this.parameters];
  }
}
