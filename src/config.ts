import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { load } from 'js-yaml';
import type { Route } from './types.ts';

interface LiteLLMConfig {
  model_list?: { model_name?: string; litellm_params?: { model?: string; api_base?: string } }[];
  general_settings?: { master_key?: string };
}

export interface LiteLLMSettings {
  configPath?: string;
  routes: Route[];
  masterKey?: string;
}

const ENV_PREFIX = 'os.environ/';
const DEFAULT_ENV_NAME = 'LITELLM_MASTER_KEY';

function defaultPaths(): string[] {
  return [
    process.env.LITELLM_CONFIG,
    join(homedir(), 'Code/otel-local-ai/litellm/config.yaml'),
    join(homedir(), '.config/litellm/config.yaml'),
    resolve('litellm_config.yaml'),
  ].filter((path): path is string => Boolean(path));
}

export function findConfigPath(explicit?: string): string | undefined {
  const candidates = explicit ? [resolve(explicit)] : defaultPaths();
  return candidates.find((path) => existsSync(path));
}

export function parseConfig(yamlText: string): { routes: Route[]; masterKeyRef?: string } {
  const document = (load(yamlText) ?? {}) as LiteLLMConfig;
  const routes = (document.model_list ?? []).flatMap((entry) => {
    const alias = entry.model_name;
    const model = entry.litellm_params?.model;
    return alias && model ? [{ alias, model, apiBase: entry.litellm_params?.api_base ?? '' }] : [];
  });
  return { routes, masterKeyRef: document.general_settings?.master_key };
}

export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    values[key] = value;
  }
  return values;
}

function readDotEnv(path: string): Record<string, string> {
  return existsSync(path) ? parseDotEnv(readFileSync(path, 'utf8')) : {};
}

export function resolveMasterKey(
  ref: string | undefined,
  configPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (ref && !ref.startsWith(ENV_PREFIX)) return ref;
  const envName = ref ? ref.slice(ENV_PREFIX.length) : DEFAULT_ENV_NAME;
  if (env[envName]) return env[envName];
  if (!configPath) return undefined;
  for (const directory of [dirname(configPath), dirname(dirname(configPath))]) {
    const value = readDotEnv(join(directory, '.env'))[envName];
    if (value) return value;
  }
  return undefined;
}

export function loadLiteLLMSettings(explicit?: string): LiteLLMSettings {
  const configPath = findConfigPath(explicit);
  if (!configPath) return { routes: [], masterKey: resolveMasterKey(undefined, undefined) };
  const { routes, masterKeyRef } = parseConfig(readFileSync(configPath, 'utf8'));
  return { configPath, routes, masterKey: resolveMasterKey(masterKeyRef, configPath) };
}
