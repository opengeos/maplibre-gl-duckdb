import { describe, expect, it } from 'vitest';
import {
  clamp,
  formatNumericValue,
  generateId,
  classNames,
} from '../src/lib/utils/helpers';

describe('generic utility functions', () => {
  it('clamps values to a numeric range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('formats numbers based on step size', () => {
    expect(formatNumericValue(5, 1)).toBe('5');
    expect(formatNumericValue(0.55, 0.01)).toBe('0.55');
    expect(formatNumericValue(0.999, 0.1)).toBe('1.0');
  });

  it('generates ids with optional prefixes', () => {
    expect(generateId('control').startsWith('control-')).toBe(true);
    expect(generateId()).not.toBe(generateId());
  });

  it('builds active class names', () => {
    expect(classNames({ active: true, disabled: false })).toBe('active');
    expect(classNames({ active: true, visible: true })).toBe('active visible');
  });
});
