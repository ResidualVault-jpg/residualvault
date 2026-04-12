'use strict';

/**
 * youtubePublisher.js
 * Uploads a local video file to the ResidualVault YouTube channel.
 *
 * Required .env keys:
 *   YOUTUBE_CLIENT_ID      — OAuth2 client ID
 *   YOUTUBE_CLIENT_SECRET  — OAuth2 client secret
 *   YOUTUBE_REFRESH_TOKEN  — long-lived refresh token
 *   YOUTUBE_CHANNEL_ID     — target channel (used for playlist targeting)
 *
 * The credentials come from Google Cloud Console → APIs & Services → Credentials.
 * Generate the refresh token once with the OAuth2 Playground or a helper script.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google }  = require('googleapis');
const fs          = require('fs');
const path        = require('path');

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

/**
 * Build an authorised YouTube client.
 *
 * Priority:
 *   1. Refresh token flow (YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET + YOUTUBE_REFRESH_TOKEN)
 *      — fully automatic, tokens are renewed indefinitely.
 *   2. Access token (YOUTUBE_ACCESS_TOKEN) — works immediately but expires in ~1 hour.
 *      Use this as a fallback or for initial testing before the refresh flow is confirmed.
 *
 * Throws if no usable credentials are present.
 */
function _buildClient() {
  const {
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REFRESH_TOKEN,
    YOUTUBE_ACCESS_TOKEN,
  } = process.env;

  if (YOUTUBE_CLIENT_ID && YOUTUBE_CLIENT_SECRET && YOUTUBE_REFRESH_TOKEN) {
    const oauth2 = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
    const creds  = { refresh_token: YOUTUBE_REFRESH_TOKEN };
    if (YOUTUBE_ACCESS_TOKEN) creds.access_token = YOUTUBE_ACCESS_TOKEN;
    oauth2.setCredentials(creds);
    return google.youtube({ version: 'v3', auth: oauth2 });
  }

  if (YOUTUBE_ACCESS_TOKEN) {
    // Direct access-token path — no refresh possible, but works immediately
    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: YOUTUBE_ACCESS_TOKEN });
    return google.youtube({ version: 'v3', auth: oauth2 });
  }

  throw new Error(
    'YouTube credentials not configured. ' +
    'Set YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET + YOUTUBE_REFRESH_TOKEN ' +
    '(or YOUTUBE_ACCESS_TOKEN for short-lived access) in .env'
  );
}

/**
 * Upload a video file to YouTube.
 *
 * @param {string} filePath        - Absolute path to the .mp4 file
 * @param {string} title           - Video title (max 100 chars)
 * @param {string} description     - Video description
 * @param {string[]} tags          - Array of keyword tags
 * @param {object}  [opts]
 * @param {string}  [opts.privacyStatus]  - 'public' | 'unlisted' | 'private'  (default: 'public')
 * @param {string}  [opts.categoryId]     - YouTube category ID (default: '22' = People & Blogs)
 * @param {string}  [opts.playlistId]     - Optional playlist ID to add the video to
 * @returns {{ videoId: string, url: string }}
 */
async function uploadVideo(filePath, title, description, tags = [], opts = {}) {
  if (!fs.existsSync(filePath)) throw new Error(`Video file not found: ${filePath}`);

  const youtube       = _buildClient();
  const privacyStatus = opts.privacyStatus || 'public';
  const categoryId    = opts.categoryId    || '22';

  const fileSize = fs.statSync(filePath).size;
  const ext      = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.mp4' ? 'video/mp4' : 'video/mpeg';

  console.log(`[YouTube] Uploading "${title}" (${(fileSize / 1024 / 1024).toFixed(1)} MB)...`);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title:       title.substring(0, 100),
        description,
        tags,
        categoryId,
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
  });

  const videoId = res.data.id;
  const url     = `https://www.youtube.com/watch?v=${videoId}`;

  console.log(`[YouTube] Upload complete: ${url}`);

  // Optionally add to playlist
  if (opts.playlistId && videoId) {
    try {
      await youtube.playlistItems.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            playlistId: opts.playlistId,
            resourceId: { kind: 'youtube#video', videoId },
          },
        },
      });
      console.log(`[YouTube] Added to playlist: ${opts.playlistId}`);
    } catch (err) {
      console.warn(`[YouTube] Playlist insert failed (non-fatal): ${err.message}`);
    }
  }

  return { videoId, url };
}

module.exports = { uploadVideo };
