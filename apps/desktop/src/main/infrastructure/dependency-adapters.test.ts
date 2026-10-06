import { describe, expect, it } from 'vitest';

import { createFetchDownloader } from './dependency-adapters';

describe('createFetchDownloader', () => {
  it('rejects non-HTTPS URLs without making a request', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(new Uint8Array());
    };
    const downloader = createFetchDownloader(fetchImpl);

    await expect(
      downloader.download('http://packages.example/wheel.whl', new AbortController().signal),
    ).rejects.toThrow('https');
    expect(calls).toBe(0);
  });

  it('passes caller cancellation to fetch', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = (_input, init) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        return Promise.reject(new Error('fetch did not receive an abort signal'));
      }
      requestSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('fetch aborted')), {
          once: true,
        });
      });
    };
    const downloader = createFetchDownloader(fetchImpl);
    const controller = new AbortController();
    const download = downloader.download('https://packages.example/wheel.whl', controller.signal);

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    controller.abort();

    await expect(download).rejects.toThrow('fetch aborted');
    expect(requestSignal?.aborted).toBe(true);
  });
});
