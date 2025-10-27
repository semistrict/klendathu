import { describe, it, expect } from 'vitest';
import { ContextItem, ContextCallable } from './launcher.js';

describe('ContextItem', () => {
  it('should store value and description', () => {
    const item = new ContextItem('test value', 'test description');
    expect(item.value).toBe('test value');
    expect(item.description).toBe('test description');
  });

  it('should allow undefined description', () => {
    const item = new ContextItem(42);
    expect(item.value).toBe(42);
    expect(item.description).toBeUndefined();
  });

  it('should handle object values', () => {
    const obj = { foo: 'bar', num: 123 };
    const item = new ContextItem(obj, 'An object');
    expect(item.value).toEqual(obj);
    expect(item.description).toBe('An object');
  });
});

describe('ContextCallable', () => {
  it('should store function and description', () => {
    const fn = (x: number) => x * 2;
    const callable = new ContextCallable(fn as (...args: unknown[]) => unknown, 'Doubles a number');

    expect(callable.func).toBe(fn);
    expect(callable.value).toBe(fn);
    expect(callable.description).toBe('Doubles a number');
  });

  it('should allow calling the stored function', () => {
    const fn = (x: number, y: number) => x + y;
    const callable = new ContextCallable(fn as (...args: unknown[]) => unknown);

    const result = (callable.func as any)(5, 3);
    expect(result).toBe(8);
  });

  it('should extend ContextItem', () => {
    const fn = () => 'hello';
    const callable = new ContextCallable(fn, 'Says hello');

    expect(callable).toBeInstanceOf(ContextItem);
    expect(callable).toBeInstanceOf(ContextCallable);
  });
});
