/**
 * Photo Curator v3.0.0 — contents/gptk-bridge.ts
 * Purpose: MAIN world content script injected into photos.google.com.
 *          Bridges between the ISOLATED world (content.ts) and window.gptkApi.
 *          MAIN world has access to window.gptkApi but NO chrome.* APIs.
 *          All backend communication goes through content.ts via postMessage.
 *
 * Changelog:
 *   v3.0.0 — Initial implementation. Handles SCAN_BATCH, TRASH_ITEMS,
 *             ADD_TO_ALBUM commands. Returns results via postMessage.
 *             Includes GPTK readiness retry loop.
 *
 * IMPORTANT: This file runs in MAIN world. Do NOT import chrome.* APIs here.
 *            Do NOT fetch the backend here. Only call window.gptkApi.
 */

import type { PlasmoCSConfig } from 'plasmo';

export const config: PlasmoCSConfig = {
  matches: ['https://photos.google.com/*'],
  run_at: 'document_idle',
  world: 'MAIN',
};

const SOURCE = 'photo-curator-ext';
const GPTK_READY_POLL_MS = 500;
const GPTK_READY_MAX_ATTEMPTS = 20; // 10 seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PCCommand {
  type: 'PC_CMD';
  source: string;
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
}

interface PCResult {
  type: 'PC_RESULT';
  source: string;
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Wait for GPTK to be ready
// ---------------------------------------------------------------------------

async function waitForGptk(): Promise<boolean> {
  for (let i = 0; i < GPTK_READY_MAX_ATTEMPTS; i++) {
    if (typeof (window as any).gptkApi !== 'undefined') return true;
    await new Promise(r => setTimeout(r, GPTK_READY_POLL_MS));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * SCAN_BATCH — fetch a page of items from GPTK oldest-first.
 * Uses getItemsByUploadedDate with cursor (nextPageId).
 * Note: GPTK sorts by upload date; creation_timestamp from metadata
 * is used for our oldest-first YYYY-MM ordering.
 */
async function handleScanBatch(payload: {
  cursor?: string;
  batchSize?: number;
}): Promise<Record<string, unknown>> {
  const gptk = (window as any).gptkApi;
  const { cursor = null, batchSize = 50 } = payload;

  const page = await gptk.getItemsByUploadedDate(cursor);

  const items = (page.items ?? []).slice(0, batchSize).map((item: any) => {
    const ts = item.creationTimestamp ?? item.uploadTimestamp ?? null;
    let monthKey: string | null = null;
    if (ts) {
      const d = new Date(ts);
      monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    return {
      mediaKey:            item.mediaKey     ?? null,
      dedupKey:            item.dedupKey     ?? null,
      filename:            item.filename     ?? null,
      mimeType:            item.mimeType     ?? null,
      creationTimestamp:   item.creationTimestamp  ?? null,
      uploadTimestamp:     item.uploadTimestamp    ?? null,
      monthKey,
      isLivePhoto:         !!item.isLivePhoto,
      livePhotoDurationMs: item.livePhotoDurationMs ?? null,
      isArchived:          !!item.isArchived,
      isFavorite:          !!item.isFavorite,
      // thumbUrl available for Phase 2 thumbnail fetch
      thumbUrl:            item.thumbUrl     ?? null,
    };
  });

  return {
    items,
    nextCursor: page.nextPageId ?? null,
    totalItems: page.totalCount ?? null,
  };
}

/**
 * TRASH_ITEMS — move items to Google Photos trash.
 * Each dedupKey covers a full Live Photo pair atomically.
 */
async function handleTrashItems(payload: {
  items: Array<{ id: number; dedupKey: string }>;
}): Promise<Record<string, unknown>> {
  const gptk = (window as any).gptkApi;
  const { items } = payload;

  const trashed: number[] = [];
  const failed: Array<{ id: number; error: string }> = [];

  // Process in batches of 50 (safe GPTK limit)
  const BATCH = 50;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    try {
      await gptk.moveItemsToTrash(batch.map((b: any) => b.dedupKey));
      trashed.push(...batch.map((b: any) => b.id));
    } catch (err: any) {
      // If batch fails, try items individually to isolate bad ones
      for (const item of batch) {
        try {
          await gptk.moveItemsToTrash([item.dedupKey]);
          trashed.push(item.id);
        } catch (e: any) {
          failed.push({ id: item.id, error: e?.message ?? 'Unknown error' });
        }
      }
    }
    // Small delay between batches
    if (i + BATCH < items.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return { trashed, failed };
}

/**
 * ADD_TO_ALBUM — add items to a named Google Photos album.
 */
async function handleAddToAlbum(payload: {
  albumId: string;
  mediaKeys: string[];
}): Promise<Record<string, unknown>> {
  const gptk = (window as any).gptkApi;
  const { albumId, mediaKeys } = payload;

  const added: string[] = [];
  const failed: Array<{ mediaKey: string; error: string }> = [];

  const BATCH = 50;
  for (let i = 0; i < mediaKeys.length; i += BATCH) {
    const batch = mediaKeys.slice(i, i + BATCH);
    try {
      await gptk.addItemsToAlbum(albumId, batch);
      added.push(...batch);
    } catch (err: any) {
      failed.push(...batch.map((k: string) => ({ mediaKey: k, error: err?.message ?? 'Unknown' })));
    }
    if (i + BATCH < mediaKeys.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return { added: added.length, failed };
}

/**
 * CREATE_ALBUM — create a new album and return its ID.
 */
async function handleCreateAlbum(payload: {
  name: string;
}): Promise<Record<string, unknown>> {
  const gptk = (window as any).gptkApi;
  const album = await gptk.createAlbum(payload.name);
  return { albumId: album.id ?? album.albumId ?? album };
}

/**
 * GET_ITEM_INFO_EXT — extended metadata for a single item (Phase 2).
 * Included here so the bridge is complete even in Phase 1.
 */
async function handleGetItemInfoExt(payload: {
  mediaKey: string;
}): Promise<Record<string, unknown>> {
  const gptk = (window as any).gptkApi;
  const info = await gptk.getItemInfoExt(payload.mediaKey);
  return {
    mediaKey:  payload.mediaKey,
    dedupKey:  info.dedupKey   ?? null,
    fileSize:  info.fileSize   ?? null,
    owner:     info.owner      ?? null,
  };
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

async function handleCommand(cmd: PCCommand): Promise<void> {
  let resultPayload: Record<string, unknown> = {};
  let action = cmd.action;

  try {
    switch (cmd.action) {
      case 'SCAN_BATCH':
        resultPayload = await handleScanBatch(cmd.payload as any);
        break;
      case 'TRASH_ITEMS':
        resultPayload = await handleTrashItems(cmd.payload as any);
        break;
      case 'ADD_TO_ALBUM':
        resultPayload = await handleAddToAlbum(cmd.payload as any);
        break;
      case 'CREATE_ALBUM':
        resultPayload = await handleCreateAlbum(cmd.payload as any);
        break;
      case 'GET_ITEM_INFO_EXT':
        resultPayload = await handleGetItemInfoExt(cmd.payload as any);
        break;
      case 'PING':
        resultPayload = { pong: true, gptkReady: typeof (window as any).gptkApi !== 'undefined' };
        break;
      default:
        throw new Error(`Unknown action: ${cmd.action}`);
    }
  } catch (err: any) {
    action = 'ERROR';
    resultPayload = { action: cmd.action, message: err?.message ?? 'Unknown error' };
  }

  const result: PCResult = {
    type: 'PC_RESULT',
    source: SOURCE,
    requestId: cmd.requestId,
    action,
    payload: resultPayload,
  };

  window.postMessage(result, '*');
}

// ---------------------------------------------------------------------------
// Init — wait for GPTK, then listen for commands
// ---------------------------------------------------------------------------

(async () => {
  const ready = await waitForGptk();

  if (!ready) {
    window.postMessage({
      type: 'PC_RESULT',
      source: SOURCE,
      requestId: 'init',
      action: 'GPTK_NOT_READY',
      payload: { message: 'GPTK did not initialise within 10s. Is it installed?' },
    }, '*');
    return;
  }

  // Signal to ISOLATED world that bridge is alive
  window.postMessage({
    type: 'PC_RESULT',
    source: SOURCE,
    requestId: 'init',
    action: 'BRIDGE_READY',
    payload: { gptkVersion: (window as any).gptkApi?.version ?? 'unknown' },
  }, '*');

  // Listen for commands from ISOLATED world
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.type !== 'PC_CMD' || msg.source !== SOURCE) return;
    handleCommand(msg as PCCommand);
  });
})();
