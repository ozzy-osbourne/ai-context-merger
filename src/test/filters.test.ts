import * as assert from 'assert';
import { isSecretFile, isMinifiedOrSourceMap, LOCK_FILE_NAMES, BINARY_EXTENSIONS } from '../constants/filters';

/**
 * Test suite for security patterns, credentials, and artifact exclusions.
 */
suite('Filters: Secret Identification & Artifact Exclusions Tests', () => {
  test('Identifies sensitive environment configuration files', () => {
    assert.strictEqual(isSecretFile('.env'), true);
    assert.strictEqual(isSecretFile('.env.local'), true);
    assert.strictEqual(isSecretFile('.env.production'), true);
    assert.strictEqual(isSecretFile('.envrc'), true);
  });

  test('Allows benign template, example, and distribution environment files', () => {
    assert.strictEqual(isSecretFile('.env.example'), false);
    assert.strictEqual(isSecretFile('.env.sample'), false);
    assert.strictEqual(isSecretFile('.env.template'), false);
  });

  test('Identifies private keys, certificates, and auth files', () => {
    assert.strictEqual(isSecretFile('id_rsa'), true);
    assert.strictEqual(isSecretFile('id_ed25519'), true);
    assert.strictEqual(isSecretFile('server.key'), true);
    assert.strictEqual(isSecretFile('cert.pem'), true);
    assert.strictEqual(isSecretFile('credentials.json'), true);
    assert.strictEqual(isSecretFile('.npmrc'), true);
  });

  test('Allows normal source files and common configs', () => {
    assert.strictEqual(isSecretFile('package.json'), false);
    assert.strictEqual(isSecretFile('main.ts'), false);
    assert.strictEqual(isSecretFile('environment.ts'), false);
  });

  test('Identifies minified code, bundles, and source maps', () => {
    assert.strictEqual(isMinifiedOrSourceMap('app.min.js'), true);
    assert.strictEqual(isMinifiedOrSourceMap('bundle.js.map'), true);
    assert.strictEqual(isMinifiedOrSourceMap('vendor.bundle.js'), true);
    assert.strictEqual(isMinifiedOrSourceMap('normal.js'), false);
  });

  test('Contains standard package manager lockfiles in whitelist', () => {
    assert.strictEqual(LOCK_FILE_NAMES.has('package-lock.json'), true);
    assert.strictEqual(LOCK_FILE_NAMES.has('pnpm-lock.yaml'), true);
    assert.strictEqual(LOCK_FILE_NAMES.has('Cargo.lock'), true);
  });

  test('Contains common media and binary extensions', () => {
    assert.strictEqual(BINARY_EXTENSIONS.has('.png'), true);
    assert.strictEqual(BINARY_EXTENSIONS.has('.exe'), true);
    assert.strictEqual(BINARY_EXTENSIONS.has('.zip'), true);
  });
});