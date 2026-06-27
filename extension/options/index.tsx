/**
 * Photo Curator v3.0.0 — options/index.tsx
 * Purpose: Extension options page for configuring backend URL and
 *          extension secret. Shown on first install and via chrome://extensions.
 *          Also shows tab-refresh reminder on first install.
 *
 * Changelog:
 *   v3.0.0 — Initial implementation.
 */

import { useEffect, useState } from 'react';

const DEFAULT_BACKEND = 'https://photo.sumeetg.duckdns.org';

function Options() {
  const [backendUrl, setBackendUrl]   = useState(DEFAULT_BACKEND);
  const [extSecret,  setExtSecret]    = useState('');
  const [saved,      setSaved]        = useState(false);
  const [testing,    setTesting]      = useState(false);
  const [testResult, setTestResult]   = useState<string | null>(null);
  const [firstInstall, setFirstInstall] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['backendUrl', 'extSecret', 'firstInstall'], (result) => {
      if (result.backendUrl) setBackendUrl(result.backendUrl);
      if (result.extSecret)  setExtSecret(result.extSecret);
      if (result.firstInstall) setFirstInstall(true);
    });
  }, []);

  const handleSave = () => {
    chrome.storage.local.set({
      backendUrl: backendUrl.trim().replace(/\/$/, ''),
      extSecret:  extSecret.trim(),
      firstInstall: false,
    }, () => {
      setSaved(true);
      setFirstInstall(false);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const url = backendUrl.trim().replace(/\/$/, '');
    const secret = extSecret.trim();
    try {
      const res = await fetch(`${url}/api/extension/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ext-Secret': secret,
        },
        body: JSON.stringify({ version: '3.0.0' }),
      });
      if (res.ok) {
        setTestResult('✅ Connected to backend successfully');
      } else {
        setTestResult(`❌ Backend returned ${res.status} — check EXT_SECRET`);
      }
    } catch (e: any) {
      setTestResult(`❌ Could not reach backend: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.h1}>📷 Photo Curator — Extension Settings</h1>

        {/* First install banner */}
        {firstInstall && (
          <div style={styles.banner}>
            <strong>🔄 Action required:</strong> Open{' '}
            <a href="https://photos.google.com" target="_blank" style={styles.link}>
              photos.google.com
            </a>{' '}
            and <strong>refresh the tab</strong> to activate the extension.
            Then configure your backend below.
          </div>
        )}

        {/* Backend URL */}
        <div style={styles.field}>
          <label style={styles.label}>Backend URL</label>
          <input
            type="url"
            value={backendUrl}
            onChange={e => setBackendUrl(e.target.value)}
            style={styles.input}
            placeholder="https://photo.sumeetg.duckdns.org"
          />
          <div style={styles.hint}>Your self-hosted Photo Curator backend</div>
        </div>

        {/* Extension secret */}
        <div style={styles.field}>
          <label style={styles.label}>Extension Secret (EXT_SECRET)</label>
          <input
            type="password"
            value={extSecret}
            onChange={e => setExtSecret(e.target.value)}
            style={styles.input}
            placeholder="32-character hex from your backend .env"
          />
          <div style={styles.hint}>Must match EXT_SECRET in your backend .env file</div>
        </div>

        {/* Actions */}
        <div style={styles.actions}>
          <button onClick={handleSave} style={styles.btnPrimary}>
            {saved ? '✅ Saved' : 'Save Settings'}
          </button>
          <button onClick={handleTest} style={styles.btnSecondary} disabled={testing}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>

        {testResult && (
          <div style={{
            ...styles.testResult,
            color: testResult.startsWith('✅') ? '#a6e3a1' : '#f38ba8',
          }}>
            {testResult}
          </div>
        )}

        {/* Usage instructions */}
        <div style={styles.divider} />
        <h2 style={styles.h2}>How to use</h2>
        <ol style={styles.ol}>
          <li>Install the <a href="https://github.com/xob0t/Google-Photos-Toolkit" target="_blank" style={styles.link}>GPTK userscript</a> via Tampermonkey</li>
          <li>Open <a href="https://photos.google.com" target="_blank" style={styles.link}>photos.google.com</a> — refresh if already open</li>
          <li>The 📷 sidebar will appear on the right side of the page</li>
          <li>Click <strong>▶ Start Scan</strong> to begin building your library database</li>
          <li>Open the <a href={backendUrl} target="_blank" style={styles.link}>PWA</a> on any device to review and swipe photos</li>
          <li>Return here and click <strong>Execute Trash</strong> to trash Bad decisions</li>
        </ol>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight:   '100vh',
    background:  '#1e1e2e',
    display:     'flex',
    justifyContent: 'center',
    padding:     '40px 20px',
    fontFamily:  'system-ui, sans-serif',
  },
  card: {
    background:   '#181825',
    borderRadius: '12px',
    padding:      '32px',
    maxWidth:     '560px',
    width:        '100%',
    color:        '#cdd6f4',
    boxShadow:    '0 4px 24px rgba(0,0,0,0.4)',
  },
  h1: {
    fontSize:     '20px',
    fontWeight:   700,
    color:        '#cba6f7',
    margin:       '0 0 24px',
  },
  h2: {
    fontSize:     '15px',
    fontWeight:   600,
    color:        '#89b4fa',
    margin:       '0 0 12px',
  },
  banner: {
    background:   '#313244',
    border:       '1px solid #cba6f7',
    borderRadius: '8px',
    padding:      '12px 16px',
    marginBottom: '24px',
    fontSize:     '13px',
    lineHeight:   '1.5',
  },
  field: {
    marginBottom: '20px',
  },
  label: {
    display:      'block',
    fontWeight:   600,
    marginBottom: '6px',
    fontSize:     '13px',
    color:        '#89b4fa',
  },
  input: {
    width:        '100%',
    background:   '#313244',
    border:       '1px solid #45475a',
    borderRadius: '6px',
    padding:      '8px 12px',
    color:        '#cdd6f4',
    fontSize:     '13px',
    boxSizing:    'border-box',
    outline:      'none',
  },
  hint: {
    color:     '#585b70',
    fontSize:  '11px',
    marginTop: '4px',
  },
  actions: {
    display:  'flex',
    gap:      '10px',
    marginTop: '8px',
  },
  btnPrimary: {
    background:   '#cba6f7',
    color:        '#1e1e2e',
    border:       'none',
    borderRadius: '6px',
    padding:      '8px 20px',
    cursor:       'pointer',
    fontWeight:   700,
    fontSize:     '13px',
  },
  btnSecondary: {
    background:   '#313244',
    color:        '#cdd6f4',
    border:       '1px solid #45475a',
    borderRadius: '6px',
    padding:      '8px 20px',
    cursor:       'pointer',
    fontWeight:   600,
    fontSize:     '13px',
  },
  testResult: {
    marginTop:  '12px',
    fontSize:   '13px',
    fontWeight: 600,
  },
  divider: {
    borderTop:  '1px solid #313244',
    margin:     '24px 0',
  },
  ol: {
    paddingLeft: '20px',
    lineHeight:  '1.8',
    fontSize:    '13px',
    color:       '#a6adc8',
  },
  link: {
    color:           '#89b4fa',
    textDecoration:  'none',
  },
};

export default Options;
