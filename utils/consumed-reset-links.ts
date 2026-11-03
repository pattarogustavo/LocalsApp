// Tracks which recovery deep links have already been processed in this app
// session, so a cached Linking.getInitialURL() value doesn't re-trigger link
// validation (and the invalid-link screen) after that link's single-use
// token has already been consumed — code mode can then render normally
// instead. Stores a hash rather than the raw URL so recovery tokens don't
// linger in memory for the life of the app process.
const consumed = new Set<string>();

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0;
  }
  return `${hash}:${url.length}`;
}

export function isResetLinkConsumed(url: string): boolean {
  return consumed.has(hashUrl(url));
}

export function markResetLinkConsumed(url: string): void {
  consumed.add(hashUrl(url));
}

// Test-only: clears tracked links so tests don't leak state across runs.
export function __clearConsumedResetLinksForTests(): void {
  consumed.clear();
}
