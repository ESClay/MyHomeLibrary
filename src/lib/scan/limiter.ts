/** A tiny concurrency limiter: at most `max` tasks run at once, the rest wait in order. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  function next() {
    if (active >= max) return;
    const start = queue.shift();
    if (start) start();
  }

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
