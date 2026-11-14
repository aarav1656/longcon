/** Every repeated chain or relayer read waits this long between calls, and only while the tab is visible. */
export const POLL_MS = 10_000;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const tabVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** Sleeps one poll gap, then keeps sleeping locally (no network) while the tab is hidden. */
export async function pollPause(sleep: (ms: number) => Promise<void> = wait, visible: () => boolean = tabVisible): Promise<void> {
  await sleep(POLL_MS);
  while (!visible()) await sleep(1000);
}
