/**
 * Installs observers on a page's `fetch` and `XMLHttpRequest`.
 *
 * Separated from the content script so it can be tested without a browser —
 * it only needs an object with `fetch` and `XMLHttpRequest` on it.
 *
 * This is the most dangerous code in the project. Everywhere else a bug means
 * our feature fails; here a bug means leetcode.com fails. Three invariants,
 * each covered by a test:
 *   1. the caller always receives the real, still-readable response
 *   2. nothing thrown by the sink can escape into the page
 *   3. non-matching traffic is passed straight through
 */

export type TrafficSink = (
  url: string,
  method: string,
  reqBody: string | undefined,
  resText: string,
) => void;

export type PatchTarget = {
  fetch: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
};

export type PatchOptions = {
  /** Cheap pre-filter. Runs on EVERY request the page makes. */
  shouldObserve: (url: string) => boolean;
  onTraffic: TrafficSink;
};

/** Installs both patches. Returns an uninstall function. */
export function installNetworkPatch(target: PatchTarget, opts: PatchOptions): () => void {
  const undo = [installFetchPatch(target, opts)];
  if (target.XMLHttpRequest) undo.push(installXhrPatch(target, opts));
  return () => { for (const f of undo.reverse()) f(); };
}

export function installFetchPatch(target: PatchTarget, opts: PatchOptions): () => void {
  const orig = target.fetch;

  target.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const [input, init] = args;
    const url =
      typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : (input as Request)?.url ?? String(input);
    const method = String(
      init?.method ?? (input as Request)?.method ?? 'GET',
    ).toUpperCase();

    // Fast path: anything not ours must cost no more than one predicate call.
    let interesting = false;
    try { interesting = opts.shouldObserve(url); } catch { /* never break the page */ }
    if (!interesting) return orig.apply(this as never, args);

    let reqBody: string | undefined;
    try {
      if (typeof init?.body === 'string') reqBody = init.body;
      else if (input instanceof Request) reqBody = await input.clone().text();
    } catch { /* unreadable body; the verdict poll still works */ }

    const res = await orig.apply(this as never, args);

    // clone() because a body can only be read once. Reading the real one would
    // hand the page an empty body. Deliberately not awaited, so the page gets
    // its response without waiting on us.
    try {
      res.clone().text()
        .then((t) => { try { opts.onTraffic(url, method, reqBody, t); } catch { /* sink errors are ours, not the page's */ } })
        .catch(() => {});
    } catch { /* clone can throw on a disturbed body */ }

    return res; // the page's response, untouched
  } as typeof fetch;

  return () => { target.fetch = orig; };
}

export function installXhrPatch(target: PatchTarget, opts: PatchOptions): () => void {
  const XHR = target.XMLHttpRequest!;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;

  XHR.prototype.open = function (this: any, method: string, url: string | URL, ...rest: unknown[]) {
    // open() knows the URL, send() knows the body, 'load' knows the response.
    // Three separate moments, so stash the first on the instance.
    this.__leetcoach = { method: String(method).toUpperCase(), url: String(url) };
    return (origOpen as any).apply(this, [method, url, ...rest]);
  };

  XHR.prototype.send = function (this: any, body?: unknown) {
    const meta = this.__leetcoach;
    let interesting = false;
    try { interesting = !!meta && opts.shouldObserve(meta.url); } catch {}

    if (interesting) {
      this.addEventListener('load', () => {
        try {
          opts.onTraffic(meta.url, meta.method, typeof body === 'string' ? body : undefined, this.responseText);
        } catch { /* never break the page */ }
      });
    }
    return (origSend as any).apply(this, [body]);
  };

  return () => { XHR.prototype.open = origOpen; XHR.prototype.send = origSend; };
}
