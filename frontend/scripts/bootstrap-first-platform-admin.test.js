'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const assert = require('node:assert/strict');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const { spawnSync } = require('node:child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const { EventEmitter } = require('node:events');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Keep this test's Node harness in CommonJS.
const test = require('node:test');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- The installer test imports its CommonJS CLI module directly.
const { askSecret, getTargetConfig, verifyDatabaseContract } = require('./bootstrap-first-platform-admin');

const scriptPath = path.join(__dirname, 'bootstrap-first-platform-admin.js');
const validEnvironment = (overrides = {}) => ({
  COCINACORE_FIRST_ADMIN_DATABASE_URL:
    'postgresql://cocinacore_first_admin_provisioner@127.0.0.1:5433/cocinacore',
  COCINACORE_FIRST_ADMIN_EXPECTED_DATABASE: 'cocinacore',
  COCINACORE_FIRST_ADMIN_EXPECTED_EMAIL: 'owner@example.com',
  ...overrides,
});

class FakeTerminalInput extends EventEmitter {
  isRaw = false;
  rawModes = [];
  resumed = false;
  paused = false;

  setEncoding(encoding) {
    this.encoding = encoding;
  }

  setRawMode(value) {
    this.isRaw = value;
    this.rawModes.push(value);
  }

  resume() {
    this.resumed = true;
  }

  pause() {
    this.paused = true;
  }
}

test('accepts only the exact loopback provisioner target and normalized expected email', () => {
  assert.deepEqual(getTargetConfig(validEnvironment()), {
    host: '127.0.0.1',
    port: 5433,
    database: 'cocinacore',
    username: 'cocinacore_first_admin_provisioner',
    expectedEmail: 'owner@example.com',
  });
});

test('rejects remote hosts, URL credentials, connection options, and system databases', () => {
  const invalidTargets = [
    validEnvironment({
      COCINACORE_FIRST_ADMIN_DATABASE_URL:
        'postgresql://cocinacore_first_admin_provisioner@db.example.com/cocinacore',
    }),
    validEnvironment({
      COCINACORE_FIRST_ADMIN_DATABASE_URL:
        'postgresql://cocinacore_first_admin_provisioner:secret@127.0.0.1/cocinacore',
    }),
    validEnvironment({
      COCINACORE_FIRST_ADMIN_DATABASE_URL:
        'postgresql://cocinacore_first_admin_provisioner@127.0.0.1/cocinacore?sslmode=disable',
    }),
    validEnvironment({ COCINACORE_FIRST_ADMIN_EXPECTED_DATABASE: 'template1' }),
    validEnvironment({ COCINACORE_FIRST_ADMIN_EXPECTED_DATABASE: 'other_database' }),
  ];

  for (const environment of invalidTargets) {
    assert.throws(() => getTargetConfig(environment), /Refusing an invalid, credential-bearing, or unexpected database target/);
  }
});

test('rejects an explicit zero database port instead of allowing pg to choose a fallback', () => {
  assert.throws(
    () => getTargetConfig(validEnvironment({
      COCINACORE_FIRST_ADMIN_DATABASE_URL:
        'postgresql://cocinacore_first_admin_provisioner@127.0.0.1:0/cocinacore',
    })),
    /Refusing an invalid, credential-bearing, or unexpected database target/
  );
});

test('binds installer role checks to the connected provisioner role', async () => {
  let queryText = '';
  const client = {
    async query(text) {
      queryText = text;
      return { rows: [] };
    },
  };

  await assert.rejects(
    verifyDatabaseContract(client, { database: 'cocinacore' }),
    /Database role, function, grant, or FORCE RLS contract mismatch/
  );

  assert.match(queryText, /from pg_catalog\.pg_roles r\s+where r\.rolname = current_user/i);
});

test('secret entry enables raw mode, never echoes input, and restores terminal mode', async () => {
  const input = new FakeTerminalInput();
  let output = '';
  const secretPromise = askSecret('Password (hidden): ', {
    input,
    output: { write: (text) => { output += text; } },
  });
  input.emit('data', 'private-secret\r');

  assert.equal(await secretPromise, 'private-secret');
  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(input.paused, true);
  assert.equal(output, 'Password (hidden): \n');
  assert.equal(output.includes('private-secret'), false);
});

test('refuses piped CLI input before reading or echoing secrets', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: 'database-secret\nadministrator-secret\n',
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '' },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Run this installer from an interactive terminal; secrets are never read from stdin pipes.\n');
  assert.equal(result.stdout.includes('database-secret'), false);
  assert.equal(result.stderr.includes('administrator-secret'), false);
});
