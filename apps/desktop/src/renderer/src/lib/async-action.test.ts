import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeActionError, reportAction, trackAction } from './async-action';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('describeActionError extracts a human-readable message from an unknown error', () => {
  it('returns the error message when given an Error with a non-empty message', () => {
    const error = new Error('网络超时');
    expect(describeActionError(error, 'fallback')).toBe('网络超时');
  });

  it('returns the fallback when given a non-Error value', () => {
    expect(describeActionError('string error', 'fallback')).toBe('fallback');
  });

  it('returns the fallback when given null', () => {
    expect(describeActionError(null, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when given undefined', () => {
    expect(describeActionError(undefined, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when given an Error with an empty message', () => {
    const error = new Error('');
    expect(describeActionError(error, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when given a number', () => {
    expect(describeActionError(42, 'fallback')).toBe('fallback');
  });
});

describe('reportAction delivers the failure message to the onError callback', () => {
  it('calls onError with the error message when the promise rejects', async () => {
    const onError = vi.fn();
    reportAction(Promise.reject(new Error('磁盘已满')), onError);
    // Allow microtasks to flush
    await new Promise((resolve) => {
      queueMicrotask(() => resolve(undefined));
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith('磁盘已满');
  });

  it('calls onError with the default fallback when the error is not an Error', async () => {
    const onError = vi.fn();
    reportAction(Promise.reject('oops'), onError);
    await new Promise((resolve) => {
      queueMicrotask(() => resolve(undefined));
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith('操作失败，请重试。');
  });

  it('calls onError with a custom fallback when provided', async () => {
    const onError = vi.fn();
    reportAction(Promise.reject(null), onError, '自定义失败消息');
    await new Promise((resolve) => {
      queueMicrotask(() => resolve(undefined));
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith('自定义失败消息');
  });

  it('does not call onError when the promise resolves', async () => {
    const onError = vi.fn();
    reportAction(Promise.resolve('ok'), onError);
    await new Promise((resolve) => {
      queueMicrotask(() => resolve(undefined));
    });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('trackAction logs failures to the console without disturbing the user', () => {
  it('calls console.error with the label and error when the promise rejects', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('sync failed');
    trackAction(Promise.reject(error), 'refreshList');
    await new Promise((resolve) => {
      queueMicrotask(() => resolve(undefined));
    });
    expect(spy).toHaveBeenCalledExactlyOnceWith('refreshList failed', error);
  });

  it('does not call console.error when the promise resolves', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    trackAction(Promise.resolve('ok'), 'refreshList');
    await new Promise((resolve) => {
      queueMicrotask(() => resolve(undefined));
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
