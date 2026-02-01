import { z } from 'zod';

import {
  Tool,
  ToolMarkerCanEdit,
  type MemoriesManagerLike
} from './tools_base.js';

interface WriteMemoryInput {
  memory_name: string;
  content: string;
  max_answer_chars?: number;
}

interface MemoryNameInput {
  memory_file_name: string;
  max_answer_chars?: number;
}

type SaveMemoryFn = (name: string, content: string) => unknown;
type LoadMemoryFn = (name: string) => unknown;
type DeleteMemoryFn = (name: string) => unknown;
type ListMemoriesFn = () => string[] | Iterable<unknown> | Promise<string[] | Iterable<unknown>>;

function bindFunction<T extends (...args: never[]) => unknown>(manager: MemoriesManagerLike, candidates: string[]): T {
  for (const key of candidates) {
    const candidate = Reflect.get(manager as object, key) as unknown;
    if (typeof candidate === 'function') {
      return (candidate as (...args: never[]) => unknown).bind(manager) as T;
    }
  }
  throw new Error(`Memories manager does not implement required method: ${candidates.join(' or ')}`);
}

function stringifyUnknown(value: unknown): string {
  if (value === undefined || value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return 'unknown';
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.iterator in value;
}

async function callListMemories(manager: MemoriesManagerLike): Promise<string[]> {
  const listFn = bindFunction<ListMemoriesFn>(manager, ['listMemories', 'list_memories']);
  const raw = await listFn();
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => stringifyUnknown(entry));
  }
  if (isIterable(raw)) {
    const result: string[] = [];
    for (const entry of raw) {
      result.push(stringifyUnknown(entry));
    }
    return result;
  }
  return [stringifyUnknown(raw)];
}

async function callSaveMemory(manager: MemoriesManagerLike, name: string, content: string): Promise<string> {
  const saveFn = bindFunction<SaveMemoryFn>(manager, ['saveMemory', 'save_memory']);
  const result = await Promise.resolve(saveFn(name, content));
  return stringifyUnknown(result);
}

async function callLoadMemory(manager: MemoriesManagerLike, name: string): Promise<string> {
  const loadFn = bindFunction<LoadMemoryFn>(manager, ['loadMemory', 'load_memory']);
  const result = await Promise.resolve(loadFn(name));
  return typeof result === 'string' ? result : stringifyUnknown(result);
}

async function callDeleteMemory(manager: MemoriesManagerLike, name: string): Promise<string> {
  const deleteFn = bindFunction<DeleteMemoryFn>(manager, ['deleteMemory', 'delete_memory']);
  const result = await Promise.resolve(deleteFn(name));
  return stringifyUnknown(result);
}

export class WriteMemoryTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit]);
  static override readonly description =
    "Writes a named markdown memory entry to Smart-Edit's project-specific memory store.";
  static override readonly inputSchema = z.object({
    memory_name: z.string().min(1, 'memory_name must not be empty'),
    content: z.string(),
    max_answer_chars: z
      .number()
      .int()
      .gte(-1, 'max_answer_chars must be -1 or a positive integer')
      .optional()
  });

  override async apply(args: WriteMemoryInput): Promise<string> {
    const { memory_name, content, max_answer_chars = -1 } = args;
    let limit = max_answer_chars;
    if (limit === -1) {
      limit = this.agent.smartEditConfig.defaultMaxToolAnswerChars;
    }
    if (limit <= 0) {
      throw new Error(`max_answer_chars must be positive or -1; got ${limit}`);
    }
    if (content.length > limit) {
      throw new Error(
        `Content for ${memory_name} is too long. Max length is ${limit} characters. Please make the content shorter.`
      );
    }

    const response = await callSaveMemory(this.memoriesManager, memory_name, content);
    return this._limitLength(response, max_answer_chars);
  }
}

export class ReadMemoryTool extends Tool {
  static override readonly description =
    "Reads the content of a memory file from Smart-Edit's project-specific memory store.";
  static override readonly inputSchema = z.object({
    memory_file_name: z.string().min(1, 'memory_file_name must not be empty'),
    max_answer_chars: z
      .number()
      .int()
      .gte(-1, 'max_answer_chars must be -1 or a positive integer')
      .optional()
  });

  override async apply(args: MemoryNameInput): Promise<string> {
    const { memory_file_name } = args;
    return callLoadMemory(this.memoriesManager, memory_file_name);
  }
}

export class ListMemoriesTool extends Tool {
  static override readonly description =
    "Lists the available memories in Smart-Edit's project-specific memory store as a JSON array.";

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    const memories = await callListMemories(this.memoriesManager);
    return JSON.stringify(memories);
  }
}

export class DeleteMemoryTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit]);
  static override readonly description =
    "Deletes a memory file from Smart-Edit's project-specific memory store.";
  static override readonly inputSchema = z.object({
    memory_file_name: z.string().min(1, 'memory_file_name must not be empty')
  });

  override async apply(args: MemoryNameInput): Promise<string> {
    const { memory_file_name } = args;
    const response = await callDeleteMemory(this.memoriesManager, memory_file_name);
    return response;
  }
}
