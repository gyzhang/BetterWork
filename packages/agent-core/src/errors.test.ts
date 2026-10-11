import { describe, expect, it } from 'vitest';

import {
  ABORT_ERROR_MESSAGE,
  ABORT_ERROR_NAME,
  abortError,
  describeError,
  isAbortError,
} from './errors';

describe('abortError', () => {
  it('creates an Error with the canonical name and message', () => {
    const error = abortError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(ABORT_ERROR_NAME);
    expect(error.message).toBe(ABORT_ERROR_MESSAGE);
  });

  it('produces distinct instances on each call', () => {
    expect(abortError()).not.toBe(abortError());
  });
});

describe('isAbortError', () => {
  it('returns true for an abortError()', () => {
    expect(isAbortError(abortError())).toBe(true);
  });

  it('returns true for a manually constructed Error with name AbortError', () => {
    const error = new Error('cancelled by user');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('returns false for a generic Error', () => {
    expect(isAbortError(new Error('something failed'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(42)).toBe(false);
    expect(isAbortError({ name: 'AbortError' })).toBe(false);
  });
});

describe('describeError', () => {
  it('returns the message for an Error instance', () => {
    expect(describeError(new Error('disk full'))).toBe('disk full');
  });

  it('stringifies non-Error values', () => {
    expect(describeError('oops')).toBe('oops');
    expect(describeError(42)).toBe('42');
    expect(describeError(null)).toBe('null');
    expect(describeError(undefined)).toBe('undefined');
  });

  it('uses String() for object throwables', () => {
    expect(describeError({ code: 'ENOENT' })).toBe('[object Object]');
  });
});
