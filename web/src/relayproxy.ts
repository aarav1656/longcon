/** Same-origin path for the relayer: the browser calls /api/relay/<name> and the Pages function forwards it. */
export const RELAY_ROUTES = ['health', 'activate', 'relay', 'round'] as const;
export const DEFAULT_UPSTREAM = 'https://teslas-mac-mini.tail57f771.ts.net/longcon-relay';

export function upstreamFor(path: string | string[] | undefined, upstream: string, method: string): string | null {
  const name = Array.isArray(path) ? path.join('/') : (path ?? '');
  const allowed = name === 'health' ? ['GET'] : name === 'activate' || name === 'relay' || name === 'round' ? ['POST'] : [];
  return allowed.includes(method) ? `${upstream.replace(/\/+$/, '')}/${name}` : null;
}
