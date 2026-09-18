import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachAliases, filterModels } from './collect.ts';
import { parsePrometheus } from './providers/llamaswap.ts';
import type { ProviderSnapshot } from './types.ts';

const fixture = (): ProviderSnapshot[] => [
  {
    provider: 'litellm',
    label: 'LiteLLM',
    url: 'http://127.0.0.1:4000',
    status: 'up',
    models: [],
    routes: [
      { alias: 'fast', model: 'openai/gemma', apiBase: 'http://host.docker.internal:8000/v1' },
      { alias: 'chat', model: 'ollama/qwen:8b', apiBase: 'http://host.docker.internal:11434' },
      { alias: 'nowhere', model: 'openai/gemma', apiBase: 'not a url' },
    ],
  },
  {
    provider: 'mlx',
    label: 'oMLX',
    url: 'http://127.0.0.1:8000',
    status: 'up',
    models: [{ id: 'gemma', loaded: true, state: 'ready' }, { id: 'other', loaded: false, state: 'idle' }],
  },
  {
    provider: 'ollama',
    label: 'Ollama',
    url: 'http://127.0.0.1:11434',
    status: 'up',
    models: [{ id: 'qwen:8b', loaded: true, state: 'ready' }],
  },
];

test('attachAliases maps LiteLLM routes onto backend models by port and stripped model name', () => {
  const snapshots = fixture();
  attachAliases(snapshots);
  assert.deepEqual(snapshots[1]!.models[0]!.aliases, ['fast']);
  assert.equal(snapshots[1]!.models[1]!.aliases, undefined);
  assert.deepEqual(snapshots[2]!.models[0]!.aliases, ['chat']);
});

test('filterModels matches ids, aliases and routes case-insensitively', () => {
  const snapshots = fixture();
  attachAliases(snapshots);
  const filtered = filterModels(snapshots, 'FAST');
  assert.equal(filtered[0]!.routes!.length, 1);
  assert.deepEqual(filtered[1]!.models.map((model) => model.id), ['gemma']);
  assert.deepEqual(filtered[2]!.models, []);
});

test('parsePrometheus reads llama.cpp gauges and ignores comments and labels', () => {
  const text = '# HELP x\nllamacpp:predicted_tokens_seconds 42.5\nfoo{a="b"} 1\nbad line\n';
  assert.deepEqual(parsePrometheus(text), { 'llamacpp:predicted_tokens_seconds': 42.5, foo: 1 });
});
