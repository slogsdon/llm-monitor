import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Regression guard for the lazy dashboard import. `report`, `providers` and `--json`
// must not pull in Ink/React, which is worth roughly 20MB RSS on a one-shot run.
// React is CommonJS, so loading it from ESM lands in require.cache; this probe reports
// the count at exit, from a clean process running the real entrypoint.
const PROBE = `
process.on('exit', () => {
  const ui = Object.keys(require.cache).filter(
    (k) => k.includes('/node_modules/react/') || k.includes('/node_modules/ink/'),
  );
  process.stderr.write('\\nUI_MODULES=' + ui.length + '\\n');
});
`;

function probe(args: string[]): number {
  const dir = mkdtempSync(join(tmpdir(), 'llm-monitor-ui-'));
  const probeFile = join(dir, 'probe.cjs');
  writeFileSync(probeFile, PROBE);
  const result = spawnSync(process.execPath, ['--require', probeFile, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  const match = /UI_MODULES=(\d+)/.exec(result.stderr);
  assert.ok(match, `probe produced no result; stderr was:\n${result.stderr}`);
  return Number(match[1]);
}

test('the probe detects the UI stack when it really is loaded', () => {
  // Without this, a probe that always reported zero would make the test below vacuous.
  const loaded = probe(['--input-type=module', '-e', "await import('ink');"]);
  assert.ok(loaded > 0, `expected ink to be detected, saw ${loaded} modules`);
});

test('report does not load the UI stack', () => {
  assert.equal(probe(['src/cli.ts', 'report', '--json']), 0, 'report must not import Ink/React');
});

test('providers does not load the UI stack', () => {
  assert.equal(probe(['src/cli.ts', 'providers', '--json']), 0, 'providers must not import Ink/React');
});
