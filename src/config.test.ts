import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, parseDotEnv, resolveMasterKey } from './config.ts';

const YAML = `
model_list:
  - model_name: fast
    litellm_params:
      model: openai/gemma-4-E4B
      api_base: http://host.docker.internal:8000/v1
  - model_name: broken
    litellm_params: {}
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
`;

test('parseConfig extracts alias routes and skips entries without a model', () => {
  const { routes, masterKeyRef } = parseConfig(YAML);
  assert.deepEqual(routes, [{ alias: 'fast', model: 'openai/gemma-4-E4B', apiBase: 'http://host.docker.internal:8000/v1' }]);
  assert.equal(masterKeyRef, 'os.environ/LITELLM_MASTER_KEY');
});

test('parseDotEnv handles export, quotes and comments', () => {
  assert.deepEqual(parseDotEnv('# c\nexport A="1"\nB=\'two\'\nC=x=y\n\nnoequals'), { A: '1', B: 'two', C: 'x=y' });
});

test('resolveMasterKey prefers env, then .env beside or above the config', () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-monitor-'));
  mkdirSync(join(root, 'litellm'));
  const configPath = join(root, 'litellm', 'config.yaml');
  writeFileSync(join(root, '.env'), 'LITELLM_MASTER_KEY=from-parent\n');

  assert.equal(resolveMasterKey('os.environ/LITELLM_MASTER_KEY', configPath, { LITELLM_MASTER_KEY: 'from-env' }), 'from-env');
  assert.equal(resolveMasterKey('os.environ/LITELLM_MASTER_KEY', configPath, {}), 'from-parent');
  assert.equal(resolveMasterKey('sk-literal', configPath, {}), 'sk-literal');
  assert.equal(resolveMasterKey(undefined, undefined, {}), undefined);
});
