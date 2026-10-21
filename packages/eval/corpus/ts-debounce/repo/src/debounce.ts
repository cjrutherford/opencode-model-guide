export type Debounced<T extends (...args: any[]) => void> = T & {
  cancel: () => void;
  flush: () => void;
};

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  waitMs: number,
): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const debounced = ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  }) as Debounced<T>;

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  debounced.flush = () => {
    // TODO: a pending call should run immediately.
  };

  return debounced;
}
