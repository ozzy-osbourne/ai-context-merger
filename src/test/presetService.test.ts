import * as assert from 'assert';
import * as vscode from 'vscode';
import { PresetService } from '../services/presetService';
import { CustomPreset } from '../types';

/**
 * Test suite for custom preset input constraints, boundary rules, and storage limits.
 */
suite('PresetService: Input Validation & Constraints Tests', () => {
  let storedPresets: CustomPreset[] = [];

  const mockContext = {
    globalState: {
      get: <T>(_key: string, defaultValue: T): T => {
        return (storedPresets as unknown as T) || defaultValue;
      },
      update: async (_key: string, value: unknown): Promise<void> => {
        storedPresets = value as CustomPreset[];
      },
      setKeysForSync: (_keys: readonly string[]): void => {}
    }
  } as unknown as vscode.ExtensionContext;

  let presetService: PresetService;

  setup(() => {
    storedPresets = [];
    presetService = new PresetService(mockContext);
  });

  test('Rejects empty or whitespace-only preset names and texts', () => {
    const emptyName = presetService.validatePreset('   ', 'valid body');
    assert.strictEqual(emptyName.isValid, false);

    const emptyText = presetService.validatePreset('Valid Title', '   ');
    assert.strictEqual(emptyText.isValid, false);
  });

  test('Rejects preset names longer than 32 characters', () => {
    const exactly32 = 'A'.repeat(32);
    const validResult = presetService.validatePreset(exactly32, 'Valid body');
    assert.strictEqual(validResult.isValid, true);

    const tooLongName = 'A'.repeat(33);
    const invalidResult = presetService.validatePreset(tooLongName, 'Valid body');
    assert.strictEqual(invalidResult.isValid, false);
    assert.strictEqual(invalidResult.warning?.includes('32 символа'), true);
  });

  test('Rejects preset texts longer than 10000 characters', () => {
    const exactly10000 = 'x'.repeat(10000);
    const validTextResult = presetService.validatePreset('Valid Title', exactly10000);
    assert.strictEqual(validTextResult.isValid, true);

    const tooLongText = 'x'.repeat(10001);
    const invalidTextResult = presetService.validatePreset('Valid Title', tooLongText);
    assert.strictEqual(invalidTextResult.isValid, false);
    assert.strictEqual(invalidTextResult.warning?.includes('10 000 символов'), true);
  });

  test('Accepts valid custom presets with trimmed parameters', () => {
    const validation = presetService.validatePreset('  🔍 SQL Opt  ', '  Optimized queries  ');
    assert.strictEqual(validation.isValid, true);
    assert.strictEqual(validation.trimmedName, '🔍 SQL Opt');
    assert.strictEqual(validation.trimmedText, 'Optimized queries');
  });

  test('Enforces hard cap limit of 50 custom presets', async () => {
    // Fill storage with 50 presets
    for (let i = 0; i < 50; i++) {
      storedPresets.push({
        id: `preset_${i}`,
        name: `Preset ${i}`,
        text: `Instruction ${i}`
      });
    }

    const result = await presetService.addCustomPreset('51st Preset', 'Body');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.includes('максимум 50'), true);
  });

  test('Performs CRUD lifecycle: Add, Edit, Delete', async () => {
    const addResult = await presetService.addCustomPreset('Initial', 'Content');
    assert.strictEqual(addResult.success, true);
    assert.ok(addResult.preset);

    const presetId = addResult.preset.id;

    const editResult = await presetService.editCustomPreset(presetId, 'Updated Name', 'Updated Content');
    assert.strictEqual(editResult.success, true);
    assert.strictEqual(editResult.preset?.name, 'Updated Name');

    const deleteResult = await presetService.deleteCustomPreset(presetId);
    assert.strictEqual(deleteResult.success, true);
    assert.strictEqual(deleteResult.updatedPresets?.length, 0);
  });
});