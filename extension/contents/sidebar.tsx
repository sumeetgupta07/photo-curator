/**
 * Photo Curator v3.0.0 — contents/sidebar.tsx
 * Purpose: Sidebar UI injected into photos.google.com.
 *          Shows scan progress, controls (Start/Pause/Resume),
 *          trash queue status, and extension health.
 *          Communicates with content.ts via chrome.runtime.sendMessage.
 *
 * Changelog:
 *   v3.0.0 — Initial implementation. Phase 1 scope: scan controls,
 *             progress display, trash execution button, bridge status.
 */

import type { PlasmoCSConfig, PlasmoGetShadowHostId } from 'plasmo';
import { useEffect, useState, useCallback } from 'react';

export const config: PlasmoCSConfig = {
  matches: ['https://photos.google.com/*'],
  run_at: 'document_idle',
};

export const getShadowHostId: PlasmoGetShadowHostId = () => 'pc-sidebar-host';

const SOURCE = 'photo-curator-ext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScanStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error';
type TrashStatus = 'idle' | 'running' | 'done' | 'empty' | 'error';

interface ScanState {
  status: ScanStatus;
  scanned: number;
  estimated: number;
  dupsFound: number;
  errorMessage?: string;
}

interface TrashState {
  status: TrashStatus;
  pending: number;
  lastTrashed: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Sidebar component
// ---------------------------------------------------------------------------

function Sidebar() {
  const [visible,     setVisible]     = useState(true);
  const [bridgeReady, setBridgeReady] = useState<boolean | null>(null);
  const [scan,        setScan]        = useState<ScanState>({
    status: 'idle', scanned: 0, estimated: 0, dupsFound: 0,
  });
  const [trash, setTrash] = useState<TrashState>({
    status: 'idle', pending: 0, lastTrashed: 0,
  });

  // ---------------------------------------------------------------------------
  // Listen for messages from content.ts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const listener = (msg: any) => {
      if (msg.source !== SOURCE) return;

      switch (msg.type) {
        case 'BRIDGE_STATUS':
          setBridgeReady(msg.ready ?? false);
          break;

        case 'SCAN_STATUS':
          setScan(prev => ({ ...prev, status: msg.status as ScanStatus }));
          break;

        case 'SCAN_PROGRESS':
          setScan(prev => ({
            ...prev,
            status: 'running',
            scanned:   msg.scanned   ?? prev.scanned,
            estimated: msg.estimated ?? prev.estimated,
            dupsFound: prev.dupsFound + (msg.dupsFound ?? 0),
          }));
          break;

        case 'SCAN_COMPLETE':
          setScan(prev => ({ ...prev, status: 'complete', scanned: msg.totalScanned ?? prev.scanned }));
          break;

        case 'SCAN_ERROR':
          setScan(prev => ({ ...prev, status: 'error', errorMessage: msg.message }));
          break;

        case 'TRASH_STATUS':
          setTrash(prev => ({
            ...prev,
            status: msg.status as TrashStatus,
            lastTrashed: msg.trashed ?? prev.lastTrashed,
            errorMessage: msg.message,
          }));
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Ask content.ts for current status on mount
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, { source: SOURCE, type: 'GET_SCAN_STATUS' },
        (res) => {
          if (!res) return;
          setScan(prev => ({
            ...prev,
            status:    res.running ? 'running' : res.paused ? 'paused' : prev.status,
            scanned:   res.totalScanned   ?? prev.scanned,
            estimated: res.totalEstimated ?? prev.estimated,
          }));
        }
      );
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Control handlers
  // ---------------------------------------------------------------------------

  const sendToContent = useCallback((type: string) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, { source: SOURCE, type });
    });
  }, []);

  const handleStart  = () => sendToContent('START_SCAN');
  const handlePause  = () => sendToContent('PAUSE_SCAN');
  const handleResume = () => sendToContent('RESUME_SCAN');
  const handleTrash  = () => sendToContent('EXECUTE_TRASH');

  // ---------------------------------------------------------------------------
  // Progress calculation
  // ---------------------------------------------------------------------------

  const pct = scan.estimated > 0
    ? Math.min(100, Math.round((scan.scanned / scan.estimated) * 100))
    : 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        style={styles.collapseBtn}
        title="Open Photo Curator"
      >
        📷
      </button>
    );
  }

  return (
    <div style={styles.sidebar}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>📷 Photo Curator</span>
        <button onClick={() => setVisible(false)} style={styles.closeBtn}>×</button>
      </div>

      {/* Bridge / GPTK status */}
      <div style={styles.section}>
        <div style={styles.statusRow}>
          <span style={{ ...styles.dot, background: bridgeReady ? '#4ade80' : '#f87171' }} />
          <span style={styles.statusLabel}>
            {bridgeReady === null
              ? 'Checking GPTK…'
              : bridgeReady
              ? 'GPTK connected'
              : 'GPTK not found — install the userscript'}
          </span>
        </div>
      </div>

      {/* Scan section */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Library Scan</div>

        {/* Progress bar */}
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${pct}%` }} />
        </div>
        <div style={styles.progressLabel}>
          {scan.estimated > 0
            ? `${scan.scanned.toLocaleString()} / ${scan.estimated.toLocaleString()} (${pct}%)`
            : `${scan.scanned.toLocaleString()} scanned`}
        </div>
        {scan.dupsFound > 0 && (
          <div style={styles.dupLabel}>🔁 {scan.dupsFound} duplicates found</div>
        )}
        {scan.status === 'error' && (
          <div style={styles.errorLabel}>⚠️ {scan.errorMessage}</div>
        )}
        {scan.status === 'complete' && (
          <div style={styles.successLabel}>✅ Scan complete</div>
        )}

        {/* Controls */}
        <div style={styles.controls}>
          {scan.status === 'idle' && (
            <button onClick={handleStart} style={styles.btnPrimary} disabled={!bridgeReady}>
              ▶ Start Scan
            </button>
          )}
          {scan.status === 'running' && (
            <button onClick={handlePause} style={styles.btnSecondary}>
              ⏸ Pause
            </button>
          )}
          {scan.status === 'paused' && (
            <button onClick={handleResume} style={styles.btnPrimary} disabled={!bridgeReady}>
              ↺ Resume
            </button>
          )}
          {scan.status === 'error' && (
            <button onClick={handleStart} style={styles.btnPrimary} disabled={!bridgeReady}>
              ↺ Retry
            </button>
          )}
        </div>
      </div>

      {/* Trash queue section */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🗑 Trash Queue</div>
        {trash.lastTrashed > 0 && (
          <div style={styles.successLabel}>✅ {trash.lastTrashed} photos trashed</div>
        )}
        {trash.status === 'running' && (
          <div style={styles.progressLabel}>Trashing…</div>
        )}
        {trash.status === 'error' && (
          <div style={styles.errorLabel}>⚠️ {trash.errorMessage}</div>
        )}
        {trash.status === 'empty' && (
          <div style={styles.progressLabel}>No pending items</div>
        )}
        <div style={styles.controls}>
          <button
            onClick={handleTrash}
            style={styles.btnDanger}
            disabled={!bridgeReady || trash.status === 'running'}
          >
            Execute Trash
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        v3.0.0 · <a href="https://photo.sumeetg.duckdns.org" target="_blank" style={styles.link}>
          Open PWA
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    position:       'fixed',
    top:            '80px',
    right:          '16px',
    width:          '260px',
    background:     '#1e1e2e',
    color:          '#cdd6f4',
    borderRadius:   '12px',
    boxShadow:      '0 8px 32px rgba(0,0,0,0.5)',
    fontFamily:     'system-ui, sans-serif',
    fontSize:       '13px',
    zIndex:         99999,
    overflow:       'hidden',
  },
  header: {
    display:         'flex',
    justifyContent:  'space-between',
    alignItems:      'center',
    padding:         '12px 14px 8px',
    borderBottom:    '1px solid #313244',
    background:      '#181825',
  },
  title: {
    fontWeight: 700,
    fontSize:   '14px',
    color:      '#cba6f7',
  },
  closeBtn: {
    background: 'none',
    border:     'none',
    color:      '#6c7086',
    fontSize:   '18px',
    cursor:     'pointer',
    padding:    '0 4px',
  },
  collapseBtn: {
    position:     'fixed',
    top:          '80px',
    right:        '16px',
    background:   '#1e1e2e',
    border:       '1px solid #313244',
    borderRadius: '8px',
    width:        '40px',
    height:       '40px',
    cursor:       'pointer',
    fontSize:     '18px',
    zIndex:       99999,
  },
  section: {
    padding:      '12px 14px',
    borderBottom: '1px solid #313244',
  },
  sectionTitle: {
    fontWeight:   600,
    marginBottom: '8px',
    color:        '#89b4fa',
  },
  statusRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        '8px',
  },
  dot: {
    width:        '8px',
    height:       '8px',
    borderRadius: '50%',
    flexShrink:   0,
  },
  statusLabel: {
    color: '#a6adc8',
  },
  progressBar: {
    background:   '#313244',
    borderRadius: '4px',
    height:       '6px',
    overflow:     'hidden',
    marginBottom: '6px',
  },
  progressFill: {
    background:     '#cba6f7',
    height:         '100%',
    borderRadius:   '4px',
    transition:     'width 0.3s ease',
  },
  progressLabel: {
    color:     '#a6adc8',
    fontSize:  '12px',
    marginBottom: '4px',
  },
  dupLabel: {
    color:     '#f9e2af',
    fontSize:  '12px',
    marginBottom: '4px',
  },
  errorLabel: {
    color:     '#f38ba8',
    fontSize:  '12px',
    marginBottom: '4px',
  },
  successLabel: {
    color:     '#a6e3a1',
    fontSize:  '12px',
    marginBottom: '4px',
  },
  controls: {
    marginTop: '8px',
    display:   'flex',
    gap:       '8px',
  },
  btnPrimary: {
    background:   '#cba6f7',
    color:        '#1e1e2e',
    border:       'none',
    borderRadius: '6px',
    padding:      '6px 14px',
    cursor:       'pointer',
    fontWeight:   600,
    fontSize:     '12px',
  },
  btnSecondary: {
    background:   '#313244',
    color:        '#cdd6f4',
    border:       'none',
    borderRadius: '6px',
    padding:      '6px 14px',
    cursor:       'pointer',
    fontWeight:   600,
    fontSize:     '12px',
  },
  btnDanger: {
    background:   '#f38ba8',
    color:        '#1e1e2e',
    border:       'none',
    borderRadius: '6px',
    padding:      '6px 14px',
    cursor:       'pointer',
    fontWeight:   600,
    fontSize:     '12px',
  },
  footer: {
    padding:   '8px 14px',
    color:     '#585b70',
    fontSize:  '11px',
    textAlign: 'center',
  },
  link: {
    color: '#89b4fa',
    textDecoration: 'none',
  },
};

export default Sidebar;
