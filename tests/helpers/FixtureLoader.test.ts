/**
 * Tests for FixtureLoader
 */

import { describe, it, expect } from 'vitest';
import { FixtureLoader } from './FixtureLoader.js';

describe('FixtureLoader', () => {
  it('should load text fixture', () => {
    const content = FixtureLoader.load('inputs/narrative/plot-ideas/simple-plot.txt');
    expect(content).toContain('Jan is a 25-year-old blacksmith');
  });

  it('should load JSON fixture', () => {
    const responses = FixtureLoader.loadJSON('mock-responses/narrative/plot-generation.json');
    expect(Array.isArray(responses)).toBe(true);
    expect(responses.length).toBeGreaterThan(0);
  });

  it('should throw when loading non-existent fixture', () => {
    expect(() => {
      FixtureLoader.load('non-existent.txt');
    }).toThrow();
  });
});
