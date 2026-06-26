// verifier.js — v1.1
// PURPOSE: Deleted-photo detection for Photo Curator.
// v1.1: 403 responses now abort the entire run and log a clear re-login
//   message. This happens when the session token is missing the
//   photoslibrary.readonly.appcreateddata scope (added in google-auth v2.1).
//   User must log out and back in once to re-consent with the new scope.

import {
  getItemsForVerification,
  markDeleted,
  markVerified,
  purgeOldDeleted,
  getActiveUserEmails,
  setNeedsReauthScope,
} from './db.js'
import { db } from './db.js'

const BATCH_SIZE    = 10
const BATCH_DELAY   = 500   // ms between batches
const MEDIA_API     = 'https://photoslibrary.googleapis.com/v1/mediaItems'

// Returns a valid access token for a given email by finding the most
// recent active session for that email.
async function getTokenForEmail(email, getValidAccessToken) {
  const row = db.prepare(`
    SELECT session_id FROM sessions
    WHERE google_email = ?
    ORDER BY updated_at DESC LIMIT 1
  `).get(email)
  if (!row) throw new Error(`No session found for ${email}`)
  return getValidAccessToken(row.session_id)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Verify one batch of items.
// Returns { checked, deleted, needsReauth } counts.
// needsReauth=true means the caller should abort the entire run.
async function verifyBatch(items, token, email) {
  let deleted = 0
  for (const item of items) {
    try {
      const res = await fetch(`${MEDIA_API}/${item.our_media_item_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 404) {
        markDeleted(item.id)
        deleted++
        console.log(`[verifier] ✗ deleted: upload#${item.id} (${item.our_media_item_id})`)
      } else if (res.status === 403) {
        // Missing photoslibrary.readonly.appcreateddata scope —
        // token was issued before v2.1 added this scope.
        // Abort the entire run; user must re-login to re-consent.
        setNeedsReauthScope(email, true)
        console.warn(
          '[verifier] ⚠ 403 PERMISSION_DENIED — token is missing the ' +
          'photoslibrary.readonly.appcreateddata scope.\n' +
          '[verifier] → Please log out and log back in to grant the new scope.\n' +
          '[verifier] → Verification will resume automatically after re-login.'
        )
        return { checked: 0, deleted: 0, needsReauth: true }
      } else if (res.ok) {
        markVerified(item.id)
      } else {
        // 5xx or unexpected — skip, will retry next run
        console.warn(`[verifier] unexpected ${res.status} for upload#${item.id} — skipping`)
      }
    } catch (err) {
      // Network error — skip, will retry next run
      console.warn(`[verifier] network error for upload#${item.id}: ${err.message}`)
    }
  }
  return { checked: items.length, deleted, needsReauth: false }
}

// Main entry point. Pass in getValidAccessToken from google-auth.js
// so verifier.js doesn't create a circular dependency.
export async function runVerificationPass(email, getValidAccessToken) {
  console.log(`[verifier] starting pass for ${email}`)

  // 1. Purge rows deleted >15 days ago
  purgeOldDeleted(email)

  // 2. Get a valid token
  let token
  try {
    token = await getTokenForEmail(email, getValidAccessToken)
  } catch (err) {
    console.warn(`[verifier] cannot get token for ${email}: ${err.message} — aborting`)
    return
  }

  // 3. Batch loop until no more items need checking
  let totalChecked = 0
  let totalDeleted = 0
  let round = 0

  while (true) {
    const batch = getItemsForVerification(email, BATCH_SIZE)
    if (batch.length === 0) break

    round++
    console.log(`[verifier] batch ${round}: checking ${batch.length} items`)
    const { checked, deleted, needsReauth } = await verifyBatch(batch, token, email)

    if (needsReauth) {
      console.warn(`[verifier] aborting pass for ${email} — re-login required`)
      return { needsReauth: true }
    }

    totalChecked += checked
    totalDeleted += deleted

    if (batch.length < BATCH_SIZE) break   // last partial batch — done
    await sleep(BATCH_DELAY)
  }

  console.log(`[verifier] pass complete for ${email}: ${totalChecked} checked, ${totalDeleted} newly deleted`)
  return { needsReauth: false }
}

// Called by the cron job — runs for all users with active sessions.
export async function runVerificationPassForAllUsers(getValidAccessToken) {
  const emails = getActiveUserEmails()
  if (emails.length === 0) {
    console.log('[verifier] cron: no active users, skipping')
    return
  }
  for (const email of emails) {
    try {
      await runVerificationPass(email, getValidAccessToken)
    } catch (err) {
      console.error(`[verifier] cron error for ${email}:`, err.message)
    }
  }
}
