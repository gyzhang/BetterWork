export interface QuitEvent {
  preventDefault(): void;
}

/** Electron does not await event handlers. Keep the app alive until cleanup finishes. */
export function createQuitHandler(
  shutdown: () => Promise<void>,
  close: () => void,
  quit: () => void,
  onError: (error: unknown) => void,
): (event: QuitEvent) => void {
  let pending = false;
  let finished = false;
  return (event) => {
    if (finished) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    Promise.resolve()
      .then(shutdown)
      .then(close)
      .then(() => {
        finished = true;
        quit();
      })
      .catch((error: unknown) => {
        pending = false;
        onError(error);
      });
  };
}
