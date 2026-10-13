// A time limit for one request, combined with the caller's own cancel signal.
// A request that stalls (easy on mobile data) is given up instead of waiting forever.

export function withTimeout(signal, ms) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); },
  };
}
