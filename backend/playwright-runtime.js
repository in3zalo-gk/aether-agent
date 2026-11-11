// Termux exposes platform=android, which Playwright's cache registry rejects.
// Only the Node process is adapted; the system Chromium binary is still used.
// Android/Termux is not an officially supported Playwright host.
export const nativePlatform = process.platform;
if (nativePlatform === 'android') {
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
}
export const { chromium } = await import('playwright');
