const HTML_ENTITIES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#x27;',
  '`': '&#x60;'
};

export function escapeHtml(str: string): string {
  return str.replace(/[<>&"'`]/g, (char) => HTML_ENTITIES[char] ?? char);
}

export function highlightToolNames(message: string, toolNames: string[]): string {
  if (toolNames.length === 0) return message;

  let highlighted = escapeHtml(message);
  for (const toolName of toolNames) {
    const regex = new RegExp(`\\b${escapeRegex(toolName)}\\b`, 'gi');
    highlighted = highlighted.replace(regex, '<span class="tool-name">$&</span>');
  }
  return highlighted;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
