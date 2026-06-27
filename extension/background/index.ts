/**
 * Photo Curator v3.0.0 — background/index.ts
 * Purpose: Extension background service worker.
 *          Handles: first-install flag, options page redirect on install.
 *          Does NOT auto-start scan or auto-execute trash — both are manual.
 *
 * Changelog:
 *   v3.0.0 — Initial implementation.
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Mark first install so options page shows the refresh banner
    chrome.storage.local.set({ firstInstall: true });
    // Open options page automatically on install
    chrome.runtime.openOptionsPage();
  }
});
