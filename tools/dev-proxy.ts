interface ProxyRequest {
  setHeader(name: string, value: string): void;
}

interface BrowserRequest {
  headers: { origin?: string | undefined };
}

/**
 * 2026-11-08: only pages served by the dev server itself get the Deckmate origin. Any other Origin passes through
 * unchanged, so the server still rejects a foreign site that reaches the proxy from the same browser.
 */
export function rewriteProxyOrigin(proxyRequest: ProxyRequest, browserRequest: BrowserRequest, targetOrigin: string,
  devOrigins: ReadonlySet<string>): void {
  const origin = browserRequest.headers.origin;
  if (origin !== undefined && devOrigins.has(origin)) proxyRequest.setHeader('Origin', targetOrigin);
}
