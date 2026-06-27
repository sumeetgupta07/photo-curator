/**
 * Photo Curator v3.0.0 — contents/content.ts
 * Purpose: ISOLATED world content script on photos.google.com.
 *          Has chrome.* API access. Communicates with:
 *            - gptk-bridge.ts (MAIN world) via window.postMessage
 *            - Backend API via fetch with X-Ext-Secret header
 *          Drives the scan loop, heartbeat, and execution queue.
 *
 * Changelog:
 *   v3.0.0 — Initial implementation. Scan loop (metadata only, Phase 1).
 *             Heartbeat to backend. Bridge health check. Scan state
 *             persisted to backend after every batch.
 */

import type { PlasmoCSConfig } from 'plasmo';

export const config: PlasmoCSConfig = {
  matches: ['https://photos.google.com/*'],
  run_at: 'document_idle',
  // Default world is ISOLATED — do NOT set world: 'MAIN' here
};

const SOURCE = 'photo-curator-ext';
const VERSION = '3.0.0';
const SCAN_BATCH_SIZE = 50;
const SCAN_ITEM_DELAY_MS = 500; // ~2 items/sec accounting for batch overhead
const HEARTBEAT_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// Config from chrome.storage.local
// ---------------------------------------------------------------------------

interface ExtConfig {
  backendUrl: string;
  extSecret: string;
}

async function getConfig(): Promise<ExtConfig> {
  return new Promise(resolve => {
    chrome.storage.local.get(['backendUrl', 'extSecret'], (result) => {
      resolve({
        backendUrl: result.backendUrl || 'https://photo.sumeetg.duckdns.org',
        extSecret:  result.extSecret  || '',
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Scan state (local, mirrors backend)
// ---------------------------------------------------------------------------

interface ScanState {
  running: boolean;
  paused: boolean;
  cursor: string | null;
  totalScanned: number;
  totalEstimated: number;
  abortController: AbortController | null;
}

const scanState: ScanState = {
  running: false,
  paused: false,
  cursor: null,
  totalScanned: 0,
  totalEstimated: 0,
  abortController: null,
};

// ---------------------------------------------------------------------------
// Bridge communication — postMessage with Promise
// ---------------------------------------------------------------------------

let pendingRequests: Map<string, { resolve: Function; reject: Function }> = new Map();
let requestCounter = 0;

function sendBridgeCommand(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const requestId = `req_${++requestCounter}_${Date.now()}`;
    pendingRequests.set(requestId, { resolve, reject });

    window.postMessage({
      type: 'PC_CMD',
      source: SOURCE,
      requestId,
      action,
      payload,
    }, '*');

    // Timeout after 30s
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Bridge timeout for ${action}`));
      }
    }, 30_000);
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.type !== 'PC_RESULT' || msg.source !== SOURCE) return;

  const pending = pendingRequests.get(msg.requestId);
  if (!pending) return; // init/broadcast messages
  pendingRequests.delete(msg.requestId);

  if (msg.action === 'ERROR') {
    pending.reject(new Error(msg.payload?.message ?? 'Bridge error'));
  } else {
    pending.resolve(msg.payload);
  }
});

// ---------------------------------------------------------------------------
// Backend API helpers
// ---------------------------------------------------------------------------

async function backendFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const cfg = await getConfig();
  const url = `${cfg.backendUrl}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Ext-Secret': cfg.extSecret,
      ...(options.headers ?? {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

async function sendHeartbeat(): Promise<void> {
  try {
    await backendFetch('/api/extension/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ version: VERSION }),
    });
  } catch (e) {
    // Heartbeat failures are non-fatal
  }
}

// Start heartbeat loop immediately
sendHeartbeat();
setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Scan state sync — load cursor from backend on init
// ---------------------------------------------------------------------------

async function loadScanStateFromBackend(): Promise<void> {
  try {
    const res = await backendFetch('/api/scan/progress');
    if (!res.ok) return;
    const data = await res.json();
    scanState.cursor        = data.cursor        ?? null;
    scanState.totalScanned  = data.totalScanned  ?? 0;
    scanState.totalEstimated= data.totalEstimated ?? 0;
  } catch (e) {
    console.warn('[PC] Could not load scan state from backend:', e);
  }
}

// ---------------------------------------------------------------------------
// Scan loop
// ---------------------------------------------------------------------------

async function runScanLoop(): Promise<void> {
  if (scanState.running) return;
  scanState.running = true;
  scanState.paused  = false;
  scanState.abortController = new AbortController();

  notifySidebar({ type: 'SCAN_STATUS', status: 'running' });

  try {
    // Ensure bridge is alive
    const pingResult = await sendBridgeCommand('PING');
    if (!pingResult.gptkReady) {
      notifySidebar({
        type: 'SCAN_ERROR',
        message: 'GPTK not ready. Ensure the GPTK userscript is installed and photos.google.com is loaded.',
      });
      return;
    }

    while (!scanState.paused) {
      const result = await sendBridgeCommand('SCAN_BATCH', {
        cursor: scanState.cursor,
        batchSize: SCAN_BATCH_SIZE,
      });

      const items     = result.items as any[];
      const nextCursor= result.nextCursor as string | null;
      const totalItems= result.totalItems as number | null;

      if (!items || items.length === 0) {
        // Library fully scanned
        await backendFetch('/api/scan/complete', { method: 'POST', body: '{}' });
        notifySidebar({ type: 'SCAN_COMPLETE', totalScanned: scanState.totalScanned });
        break;
      }

      // POST batch to backend
      scanState.totalScanned += items.length;
      if (totalItems) scanState.totalEstimated = totalItems;

      const batchRes = await backendFetch('/api/scan/batch', {
        method: 'POST',
        body: JSON.stringify({
          items,
          cursor: nextCursor,
          totalScanned: scanState.totalScanned,
          totalEstimated: scanState.totalEstimated,
        }),
      });

      if (batchRes.ok) {
        const batchData = await batchRes.json();
        notifySidebar({
          type: 'SCAN_PROGRESS',
          scanned: scanState.totalScanned,
          estimated: scanState.totalEstimated,
          dupsFound: batchData.dupsFound ?? 0,
          cursor: nextCursor,
        });
      }

      scanState.cursor = nextCursor;

      if (!nextCursor) {
        // No more pages
        await backendFetch('/api/scan/complete', { method: 'POST', body: '{}' });
        notifySidebar({ type: 'SCAN_COMPLETE', totalScanned: scanState.totalScanned });
        break;
      }

      // Throttle: ~2 items/sec
      await new Promise(r => setTimeout(r, SCAN_ITEM_DELAY_MS));
    }

    if (scanState.paused) {
      notifySidebar({ type: 'SCAN_STATUS', status: 'paused', cursor: scanState.cursor });
    }
  } catch (err: any) {
    console.error('[PC] Scan error:', err);
    notifySidebar({ type: 'SCAN_ERROR', message: err?.message ?? 'Scan failed' });
  } finally {
    scanState.running = false;
  }
}

function pauseScan(): void {
  if (!scanState.running) return;
  scanState.paused = true;
  // Scan loop checks paused flag between batches — finishes current batch first
}

function resumeScan(): void {
  if (scanState.running) return;
  if (!scanState.paused) return;
  runScanLoop();
}

// ---------------------------------------------------------------------------
// Sidebar notification — sends message to extension popup/sidebar
// ---------------------------------------------------------------------------

function notifySidebar(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage({ ...msg, source: SOURCE }).catch(() => {
    // Sidebar may not be open — ignore
  });
}

// ---------------------------------------------------------------------------
// Message listener — receives commands from sidebar/popup
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.source !== SOURCE) return;

  switch (msg.type) {
    case 'START_SCAN':
      loadScanStateFromBackend().then(() => runScanLoop());
      sendResponse({ ok: true });
      break;

    case 'PAUSE_SCAN':
      pauseScan();
      sendResponse({ ok: true });
      break;

    case 'RESUME_SCAN':
      resumeScan();
      sendResponse({ ok: true });
      break;

    case 'GET_SCAN_STATUS':
      sendResponse({
        running: scanState.running,
        paused: scanState.paused,
        cursor: scanState.cursor,
        totalScanned: scanState.totalScanned,
        totalEstimated: scanState.totalEstimated,
      });
      break;

    case 'EXECUTE_TRASH':
      executeTrashQueue();
      sendResponse({ ok: true });
      break;

    default:
      break;
  }

  return true; // Keep message channel open for async sendResponse
});

// ---------------------------------------------------------------------------
// Trash execution (triggered manually from sidebar)
// ---------------------------------------------------------------------------

async function executeTrashQueue(): Promise<void> {
  notifySidebar({ type: 'TRASH_STATUS', status: 'running' });

  try {
    const res = await backendFetch('/api/extension/trash-queue');
    if (!res.ok) throw new Error('Failed to fetch trash queue');
    const { items } = await res.json();

    if (!items || items.length === 0) {
      notifySidebar({ type: 'TRASH_STATUS', status: 'empty' });
      return;
    }

    // Execute via bridge
    const result = await sendBridgeCommand('TRASH_ITEMS', { items });
    const { trashed, failed } = result as { trashed: number[]; failed: any[] };

    // Confirm to backend
    if (trashed.length > 0) {
      await backendFetch('/api/extension/trash-confirm', {
        method: 'POST',
        body: JSON.stringify({ ids: trashed }),
      });
    }

    // Report individual failures
    for (const f of (failed ?? [])) {
      await backendFetch('/api/extension/trash-error', {
        method: 'POST',
        body: JSON.stringify({ id: f.id, error: f.error }),
      });
    }

    notifySidebar({
      type: 'TRASH_STATUS',
      status: 'done',
      trashed: trashed.length,
      failed: (failed ?? []).length,
    });
  } catch (err: any) {
    notifySidebar({ type: 'TRASH_STATUS', status: 'error', message: err?.message });
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async () => {
  // Check bridge readiness passively — don't auto-start scan
  try {
    const ping = await sendBridgeCommand('PING');
    notifySidebar({
      type: 'BRIDGE_STATUS',
      ready: ping.gptkReady ?? false,
      gptkVersion: (ping as any).gptkVersion ?? null,
    });
  } catch (e) {
    notifySidebar({ type: 'BRIDGE_STATUS', ready: false });
  }
})();
