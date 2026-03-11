/**
 * Unit tests for error policies and validators.
 */

import { describe, it, expect } from 'vitest';
import {
  validateJSON,
  validateNonEmpty,
  createJSONValidator,
  getDefaultPolicy,
  DEFAULT_D_POLICY,
  DEFAULT_S_POLICY,
  DEFAULT_U_POLICY,
} from '../../../src/core/dag/errorPolicies.js';

describe('errorPolicies', () => {
  // ===========================================================================
  // validateJSON
  // ===========================================================================

  describe('validateJSON', () => {
    it('valid JSON returns parsed data', () => {
      const result = validateJSON({ content: '{"a": 1}' });
      expect(result.valid).toBe(true);
      expect(result.data).toEqual({ a: 1 });
    });

    it('empty content returns error', () => {
      const result = validateJSON({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No content');
    });

    it('malformed JSON returns error', () => {
      const result = validateJSON({ content: '{bad json' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not valid JSON');
    });
  });

  // ===========================================================================
  // validateNonEmpty
  // ===========================================================================

  describe('validateNonEmpty', () => {
    it('non-empty content is valid', () => {
      const result = validateNonEmpty({ content: 'hello' });
      expect(result.valid).toBe(true);
    });

    it('empty string is invalid', () => {
      const result = validateNonEmpty({ content: '' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('whitespace-only is invalid', () => {
      const result = validateNonEmpty({ content: '   \n  ' });
      expect(result.valid).toBe(false);
    });

    it('undefined content is invalid', () => {
      const result = validateNonEmpty({});
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // createJSONValidator
  // ===========================================================================

  describe('createJSONValidator', () => {
    it('valid when required fields present', () => {
      const validator = createJSONValidator(['name', 'age']);
      const result = validator({ content: '{"name": "Alice", "age": 30}' });
      expect(result.valid).toBe(true);
      expect(result.data).toEqual({ name: 'Alice', age: 30 });
    });

    it('invalid when required field missing', () => {
      const validator = createJSONValidator(['name', 'age']);
      const result = validator({ content: '{"name": "Alice"}' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('age');
    });

    it('validates array fields are non-empty arrays', () => {
      const validator = createJSONValidator(['items'], ['items']);
      const result = validator({ content: '{"items": [1, 2, 3]}' });
      expect(result.valid).toBe(true);
    });

    it('invalid when array field is empty', () => {
      const validator = createJSONValidator(['items'], ['items']);
      const result = validator({ content: '{"items": []}' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('non-empty array');
    });

    it('invalid when array field is not array', () => {
      const validator = createJSONValidator(['items'], ['items']);
      const result = validator({ content: '{"items": "not array"}' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be an array');
    });

    it('delegates to validateJSON for invalid JSON', () => {
      const validator = createJSONValidator(['name']);
      const result = validator({ content: 'not json' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not valid JSON');
    });
  });

  // ===========================================================================
  // getDefaultPolicy
  // ===========================================================================

  describe('getDefaultPolicy', () => {
    it('D policy matches DEFAULT_D_POLICY', () => {
      const policy = getDefaultPolicy('D');
      expect(policy.maxRetries).toBe(DEFAULT_D_POLICY.maxRetries);
      expect(policy.retryStrategy).toBe(DEFAULT_D_POLICY.retryStrategy);
      expect(policy.onExhausted).toBe(DEFAULT_D_POLICY.onExhausted);
    });

    it('S policy matches DEFAULT_S_POLICY', () => {
      const policy = getDefaultPolicy('S');
      expect(policy.maxRetries).toBe(DEFAULT_S_POLICY.maxRetries);
      expect(policy.retryStrategy).toBe(DEFAULT_S_POLICY.retryStrategy);
    });

    it('U policy matches DEFAULT_U_POLICY', () => {
      const policy = getDefaultPolicy('U');
      expect(policy.maxRetries).toBe(DEFAULT_U_POLICY.maxRetries);
    });

    it('returns fresh copy (not shared ref)', () => {
      const p1 = getDefaultPolicy('D');
      const p2 = getDefaultPolicy('D');
      expect(p1).not.toBe(p2);
      p1.maxRetries = 99;
      expect(p2.maxRetries).toBe(DEFAULT_D_POLICY.maxRetries);
    });
  });
});
