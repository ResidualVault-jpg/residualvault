'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const axios     = require('axios');
const fs        = require('fs');
const path      = require('path');
const db        = require('../db');

const HEYGEN_BASE  = 'https://api.heygen.com';
const OUTPUT_DIR   = path.join(__dirname, '../video/output');
const AVATAR_ID    = 'Bryan_Suit_Front_public';
const VOICE_ID     = '828b59f834fd4c7188da322b6d9b6c75'; // David Castlemore

// HeyGen built-in background IDs (corporate / professional library)
// These are discovered at runtime via /v2/backgrounds; kept as fallbacks.
const BG_FALLBACKS = {
  lobby:        { type: 'color', value: '#0d1b2a' }, // deep navy — office feel
  hallway:      { type: 'color', value: '#1a2332' },
  privateOffice:{ type: 'color', value: '#1c1c2e' },
  desk:         { type: 'color', value: '#111827' },
  conferenceRoom:{ type: 'color', value: '#0f172a' },
};

// ResidualVault brand data always shown on the conference-room whiteboard (verbally)
const BRAND_STATS = {
  protocols:   '156+',
  apyTop:      '32%',
  apyLabel:    'Live APY Tracking',
  plans:       'Free & PRO Plans',
  site:        'ResidualVault.com',
};

/**
 * HeyGenVideoAgent — World-Class YouTube Production Pipeline
 *
 * Produces two video formats every Monday at 10 AM:
 *
 *  1. "Office Journey"    — Bryan_Suit_Front_public walks lobby → hallway → office → desk
 *  2. "Conference Room"   — Bryan stands at whiteboard, delivers authoritative pitch
 *
 * Full pipeline:
 *   Claude writes fresh scripts → HeyGen renders → poll for completion →
 *   download to video/output/ → upload to YouTube via youtubePublisher.js →
 *   log everything to SQLite via db.js
 */
class HeyGenVideoAgent extends BaseAgent {
  constructor() {
    super({
      name:      'HeyGen Video Agent',
      role:      'You are a world-class video content director for ResidualVault, a crypto staking and ' +
                 'passive income intelligence platform. You write compelling, authoritative scripts for ' +
                 'Bryan Castlemore — a confident Wall Street-style advisor — who presents ResidualVault\'s ' +
                 'weekly insights directly to camera. Every script must feel fresh, data-driven, and urgent.',
      model:     'claude-opus-4-5',
      schedule:  '0 10 * * 1',  // Every Monday at 10 AM
      maxTokens: 8096,
    });

    this.apiKey  = process.env.HEYGEN_API_KEY;

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // ─── HTTP Helpers ─────────────────────────────────────────────────────────

  get _headers() {
    return { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' };
  }

  async _heygenGet(endpointPath) {
    const { data } = await axios.get(`${HEYGEN_BASE}${endpointPath}`, { headers: this._headers });
    return data;
  }

  async _heygenPost(endpointPath, body) {
    const { data } = await axios.post(`${HEYGEN_BASE}${endpointPath}`, body, { headers: this._headers });
    return data;
  }

  // ─── Background Resolution ────────────────────────────────────────────────

  /**
   * Fetch HeyGen's background library and find the best match for a keyword.
   * Falls back to BG_FALLBACKS[fallbackKey] if nothing is found.
   */
  async _resolveBackground(keyword, fallbackKey) {
    try {
      const res  = await this._heygenGet('/v2/backgrounds');
      const list = res.data?.backgrounds || res.data || [];
      if (Array.isArray(list) && list.length > 0) {
        const kw    = keyword.toLowerCase();
        const match = list.find(b =>
          (b.name || b.id || '').toLowerCase().includes(kw)
        );
        if (match) {
          this._log('info', `Background matched "${keyword}": ${match.id || match.name}`);
          return { type: 'image', background_id: match.id };
        }
      }
    } catch (err) {
      this._log('info', `Background lookup skipped (${err.message}), using fallback`);
    }
    return BG_FALLBACKS[fallbackKey] || BG_FALLBACKS.lobby;
  }

  // ─── Protocol Context ─────────────────────────────────────────────────────

  /**
   * Pull top-performing protocol data from the DB (generated_content table).
   * Falls back to curated ResidualVault brand stats if DB has no protocol data.
   */
  _getTopProtocolContext() {
    try {
      const rows = db.db.prepare(`
        SELECT content FROM generated_content
        WHERE  content_type IN ('protocol-data','analytics','report')
        ORDER  BY created_at DESC
        LIMIT  3
      `).all();

      if (rows.length > 0) {
        // Return a condensed summary for the prompt
        return rows.map(r => {
          try { return JSON.stringify(JSON.parse(r.content)).substring(0, 300); }
          catch { return String(r.content).substring(0, 300); }
        }).join('\n');
      }
    } catch (_) {}

    // Static brand context as fallback
    return JSON.stringify({
      topProtocols: ['Ethereum 2.0 (4.2% APY)', 'Cosmos (18% APY)', 'Polkadot (14% APY)',
                     'Cardano (5.1% APY)', 'Solana (6.8% APY)'],
      totalProtocols: '156+',
      weeklyTopYield: '32% APY',
      platform: 'ResidualVault.com',
      note: 'Live comparison across 156+ staking protocols',
    });
  }

  // ─── Script Writing ───────────────────────────────────────────────────────

  /**
   * Generate a fresh 4-scene "Office Journey" script where Bryan walks
   * through the ResidualVault HQ office, building to a desk CTA.
   */
  async writeOfficeJourneyScript(protocolContext) {
    const weekStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const raw = await this.ask(`
You are writing a world-class YouTube video script for ResidualVault — a crypto staking intelligence platform.

PRESENTER: Bryan Castlemore — confident, authoritative, Wall Street-level advisor
VIDEO FORMAT: "Office Journey" — Bryan walks through ResidualVault HQ, scene by scene
DATE: Week of ${weekStr}
TONE: Professional, educational, urgent — like a Bloomberg market update

CURRENT PLATFORM DATA (use this to make the script feel live and current):
${protocolContext}

BRAND FACTS TO WEAVE IN NATURALLY:
- ResidualVault.com tracks ${BRAND_STATS.protocols} staking protocols
- ${BRAND_STATS.apyLabel} — compare every protocol in real time
- Top yields this week up to ${BRAND_STATS.apyTop} APY
- ${BRAND_STATS.plans} available
- CTA: "Visit ${BRAND_STATS.site} today"

SCENE REQUIREMENTS:
Scene 1 — LOBBY (hook, 15–18 seconds):
  Bryan strides through a modern corporate lobby. Opens with a powerful, provocative statement about passive income or crypto staking. Teases what viewers will learn. High-energy.

Scene 2 — OFFICE HALLWAY (context, 18–22 seconds):
  Bryan walks purposefully down a sleek office hallway. Explains the problem — most people miss the best staking yields because they can't monitor 156+ protocols manually.

Scene 3 — PRIVATE OFFICE (solution, 20–25 seconds):
  Bryan enters his executive office, gestures around him. Introduces ResidualVault as the solution — the intelligence platform that does the monitoring for you, 24/7.

Scene 4 — EXECUTIVE DESK (CTA, 15–18 seconds):
  Bryan sits at his executive desk, looks directly into camera with authority. Delivers the numbers (top yields this week), urgency, and a crisp CTA to visit ResidualVault.com.

SCRIPT RULES:
- 60–90 total seconds spoken across all 4 scenes
- Pure spoken words only — no stage directions, no markdown
- Each scene's script must feel natural at that specific location
- Open Scene 1 with a HOOK that stops the scroll
- Every scene transitions naturally to the next
- Use SPECIFIC numbers from the protocol data above

Output this exact JSON structure:
{
  "videoTitle": "string (max 80 chars, SEO-optimised for YouTube)",
  "youtubeDescription": "string (200–250 words, includes ResidualVault.com, target keywords)",
  "youtubeTags": ["string"],
  "thumbnailConcept": "string (art direction for thumbnail designer)",
  "totalEstimatedSeconds": number,
  "scenes": [
    {
      "sceneNumber": 1,
      "location": "Corporate Lobby",
      "backgroundKeyword": "lobby",
      "estimatedSeconds": number,
      "script": "string (spoken words only)"
    },
    {
      "sceneNumber": 2,
      "location": "Office Hallway",
      "backgroundKeyword": "hallway",
      "estimatedSeconds": number,
      "script": "string"
    },
    {
      "sceneNumber": 3,
      "location": "Private Office",
      "backgroundKeyword": "office",
      "estimatedSeconds": number,
      "script": "string"
    },
    {
      "sceneNumber": 4,
      "location": "Executive Desk",
      "backgroundKeyword": "desk",
      "estimatedSeconds": number,
      "script": "string"
    }
  ]
}
`);

    const parsed = this.parseJSON(raw);
    if (!parsed || !Array.isArray(parsed.scenes)) {
      throw new Error('Office Journey script generation returned invalid structure');
    }
    return parsed;
  }

  /**
   * Generate a single-scene "Conference Room" script where Bryan presents
   * at a whiteboard covered in ResidualVault's key data points.
   */
  async writeConferenceRoomScript(protocolContext) {
    const weekStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const raw = await this.ask(`
You are writing a world-class YouTube video script for ResidualVault.

PRESENTER: Bryan Castlemore — stands in a professional conference room
VIDEO FORMAT: "Conference Room" — single scene, whiteboard visible behind Bryan
DATE: Week of ${weekStr}
TONE: Authoritative, data-driven, educational — like a CFA presenting quarterly results

WHITEBOARD BEHIND BRYAN shows these 4 items (reference them naturally in the script):
  1. "${BRAND_STATS.protocols} Staking Protocols"
  2. "${BRAND_STATS.apyLabel}"
  3. "Up to ${BRAND_STATS.apyTop} APY"
  4. "${BRAND_STATS.plans}"

CURRENT PLATFORM DATA:
${protocolContext}

SCRIPT REQUIREMENTS:
- Duration: 60–90 seconds (single unbroken speech)
- OPEN with a powerful hook about passive income or the crypto staking opportunity
- Reference the whiteboard items naturally — point to them as you would in a real presentation
- Build to a confident, specific pitch for ResidualVault.com
- Include concrete numbers from the protocol data
- CLOSE with a strong, clear CTA: "Visit ResidualVault.com today — it's free to start"
- Tone: calm authority, not hype — you are the smartest person in the room

Output this exact JSON structure:
{
  "videoTitle": "string (max 80 chars, SEO-optimised for YouTube)",
  "youtubeDescription": "string (200–250 words, ResidualVault.com, target keywords)",
  "youtubeTags": ["string"],
  "thumbnailConcept": "string (art direction)",
  "estimatedSeconds": number,
  "script": "string (full 60–90 second spoken script, no markdown, no stage directions)"
}
`);

    const parsed = this.parseJSON(raw);
    if (!parsed || !parsed.script) {
      throw new Error('Conference Room script generation returned invalid structure');
    }
    return parsed;
  }

  // ─── HeyGen Video Submission ──────────────────────────────────────────────

  /**
   * Submit "Office Journey" — 4-scene multi-input video.
   */
  async submitOfficeJourneyVideo(scriptPlan) {
    const backgroundKeys = ['lobby', 'hallway', 'privateOffice', 'desk'];

    // Resolve backgrounds in parallel
    const backgrounds = await Promise.all(
      scriptPlan.scenes.map((scene, i) =>
        this._resolveBackground(scene.backgroundKeyword || backgroundKeys[i], backgroundKeys[i])
      )
    );

    const video_inputs = scriptPlan.scenes.map((scene, i) => ({
      character: {
        type:         'avatar',
        avatar_id:    AVATAR_ID,
        avatar_style: 'normal',
      },
      voice: {
        type:       'text',
        input_text: scene.script,
        voice_id:   VOICE_ID,
        speed:      1.0,
      },
      background: backgrounds[i],
    }));

    const payload = {
      video_inputs,
      dimension: { width: 1920, height: 1080 }, // 1080p 16:9
      title:     scriptPlan.videoTitle,
    };

    this._log('info', `Submitting Office Journey: ${scriptPlan.scenes.length} scenes, 1080p`);
    const res = await this._heygenPost('/v2/video/generate', payload);

    if (!res.data?.video_id) {
      throw new Error(`HeyGen submit failed: ${JSON.stringify(res)}`);
    }
    return res.data.video_id;
  }

  /**
   * Submit "Conference Room" — single-scene video with whiteboard background.
   */
  async submitConferenceRoomVideo(scriptPlan) {
    const background = await this._resolveBackground('conference', 'conferenceRoom');

    const payload = {
      video_inputs: [{
        character: {
          type:         'avatar',
          avatar_id:    AVATAR_ID,
          avatar_style: 'normal',
        },
        voice: {
          type:       'text',
          input_text: scriptPlan.script,
          voice_id:   VOICE_ID,
          speed:      1.0,
        },
        background,
      }],
      dimension: { width: 1920, height: 1080 }, // 1080p 16:9
      title:     scriptPlan.videoTitle,
    };

    this._log('info', `Submitting Conference Room: 1 scene, 1080p`);
    const res = await this._heygenPost('/v2/video/generate', payload);

    if (!res.data?.video_id) {
      throw new Error(`HeyGen submit failed: ${JSON.stringify(res)}`);
    }
    return res.data.video_id;
  }

  // ─── Polling & Download ───────────────────────────────────────────────────

  /**
   * Poll HeyGen for a video's status.
   * Returns { status, videoUrl } — does not block; caller decides when to stop.
   */
  async _checkVideoStatus(videoId) {
    const res    = await this._heygenGet(`/v1/video_status.get?video_id=${videoId}`);
    const status = res.data?.status;
    const url    = res.data?.video_url || null;
    return { status, videoUrl: url };
  }

  /**
   * Download a completed HeyGen video to OUTPUT_DIR.
   * @returns {string} local file path
   */
  async _downloadVideo(videoUrl, filename) {
    const filePath = path.join(OUTPUT_DIR, filename);
    const writer   = fs.createWriteStream(filePath);

    const response = await axios.get(videoUrl, { responseType: 'stream' });
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    this._log('info', `Downloaded: ${filename} (${sizeMB} MB)`);
    return filePath;
  }

  /**
   * Try to upload a downloaded video to YouTube.
   * Gracefully skips if YouTube credentials are not configured.
   */
  async _uploadToYouTube(filePath, title, description, tags) {
    try {
      const { uploadVideo } = require('../dashboard/youtubePublisher');
      const result = await uploadVideo(filePath, title, description, tags, {
        privacyStatus: 'public',
        categoryId:    '22', // People & Blogs
      });
      this._log('info', `YouTube upload complete: ${result.url}`);
      return result;
    } catch (err) {
      // YouTube credentials not configured — log and continue
      this._log('info', `YouTube upload skipped: ${err.message}`);
      return null;
    }
  }

  // ─── Pending Video Checker ────────────────────────────────────────────────

  /**
   * Each run: find all videos still marked 'processing' in the DB,
   * check their HeyGen status, and — if complete — download and upload to YouTube.
   */
  async checkPendingVideos() {
    const rows = db.db.prepare(`
      SELECT id, title, metadata
      FROM   generated_content
      WHERE  content_type IN ('video-office-journey','video-conference-room','video')
        AND  metadata LIKE '%"status":"processing"%'
      ORDER  BY created_at DESC
      LIMIT  10
    `).all();

    if (!rows.length) {
      this._log('info', 'No pending videos to check');
      return [];
    }

    const updates = [];

    for (const row of rows) {
      let meta;
      try { meta = JSON.parse(row.metadata); } catch { continue; }
      if (!meta.videoId) continue;

      try {
        const { status, videoUrl } = await this._checkVideoStatus(meta.videoId);
        this._log('info', `Pending check "${row.title}": ${status}`);

        if (status === 'completed' && videoUrl) {
          // Download
          const safeTitle = row.title.replace(/[^a-z0-9_-]/gi, '_').substring(0, 60);
          const filename  = `${safeTitle}_${meta.videoId.substring(0, 8)}.mp4`;
          const localPath = await this._downloadVideo(videoUrl, filename);

          // Upload to YouTube
          const ytResult = await this._uploadToYouTube(
            localPath,
            row.title,
            meta.youtubeDescription || `${row.title} — ResidualVault.com`,
            meta.youtubeTags || ['ResidualVault', 'passive income', 'crypto staking']
          );

          meta.status       = 'completed';
          meta.videoUrl     = videoUrl;
          meta.localPath    = localPath;
          meta.youtubeUrl   = ytResult?.url   || null;
          meta.youtubeId    = ytResult?.videoId || null;
          meta.completedAt  = new Date().toISOString();

          db.db.prepare(`UPDATE generated_content SET url = ?, metadata = ? WHERE id = ?`)
            .run(ytResult?.url || videoUrl, JSON.stringify(meta), row.id);

          updates.push({
            id:         row.id,
            title:      row.title,
            status:     'completed',
            localPath,
            youtubeUrl: meta.youtubeUrl,
          });

        } else if (status === 'failed') {
          meta.status    = 'failed';
          meta.error     = 'HeyGen reported failure';
          meta.checkedAt = new Date().toISOString();
          db.db.prepare(`UPDATE generated_content SET metadata = ? WHERE id = ?`)
            .run(JSON.stringify(meta), row.id);
          await this.reportIssue('medium', `Video Failed: ${row.title}`, `videoId: ${meta.videoId}`);
          updates.push({ id: row.id, title: row.title, status: 'failed' });
        }
        // still processing — leave in DB, check next run
      } catch (err) {
        this._log('error', `Pending check error for "${row.title}": ${err.message}`);
      }
    }

    return updates;
  }

  // ─── DB Persistence ───────────────────────────────────────────────────────

  _saveVideoRecord(contentType, title, scriptPlan, videoId, format) {
    db.saveGeneratedContent(
      this.name,
      contentType,
      title,
      JSON.stringify(scriptPlan, null, 2),
      null,
      {
        videoId,
        format,
        status:             'processing',
        avatar:             AVATAR_ID,
        voice:              VOICE_ID,
        youtubeDescription: scriptPlan.youtubeDescription || '',
        youtubeTags:        scriptPlan.youtubeTags        || [],
        thumbnailConcept:   scriptPlan.thumbnailConcept   || '',
        submittedAt:        new Date().toISOString(),
      }
    );
  }

  // ─── Main Execute ─────────────────────────────────────────────────────────

  async execute(context = {}) {
    if (!this.apiKey) {
      this._log('warning', 'HEYGEN_API_KEY not configured — skipping');
      return { skipped: true, reason: 'missing_api_key' };
    }

    // ── Step 1: Check previously submitted videos ──────────────────────────
    let pendingUpdates = [];
    try {
      pendingUpdates = await this.checkPendingVideos();
      if (pendingUpdates.length) {
        this._log('info', `Pending updates: ${pendingUpdates.length} video(s) resolved`);
      }
    } catch (err) {
      this._log('error', `Pending check error: ${err.message}`);
    }

    // ── Step 2: Get this week's protocol context for dynamic scripts ────────
    const protocolContext = this._getTopProtocolContext();

    const weekLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const results   = [];

    // ── Step 3a: Office Journey video ──────────────────────────────────────
    try {
      this._log('info', 'Writing Office Journey script...');
      const ojScript = await this.writeOfficeJourneyScript(protocolContext);
      this._log('info', `Script: "${ojScript.videoTitle}" — ${ojScript.scenes?.length} scenes, ~${ojScript.totalEstimatedSeconds}s`);

      const ojVideoId = await this.submitOfficeJourneyVideo(ojScript);
      this._log('info', `Office Journey submitted → videoId: ${ojVideoId}`);

      this._saveVideoRecord(
        'video-office-journey',
        ojScript.videoTitle || `Office Journey — ${weekLabel}`,
        ojScript,
        ojVideoId,
        'office-journey'
      );

      results.push({
        format:  'office-journey',
        title:   ojScript.videoTitle,
        videoId: ojVideoId,
        scenes:  ojScript.scenes?.length,
        status:  'processing',
      });
    } catch (err) {
      this._log('error', `Office Journey failed: ${err.message}`);
      await this.reportIssue('high', 'Office Journey Video Failed', err.message);
      results.push({ format: 'office-journey', status: 'failed', error: err.message });
    }

    // ── Step 3b: Conference Room video ─────────────────────────────────────
    try {
      this._log('info', 'Writing Conference Room script...');
      const crScript = await this.writeConferenceRoomScript(protocolContext);
      this._log('info', `Script: "${crScript.videoTitle}" — ~${crScript.estimatedSeconds}s`);

      const crVideoId = await this.submitConferenceRoomVideo(crScript);
      this._log('info', `Conference Room submitted → videoId: ${crVideoId}`);

      this._saveVideoRecord(
        'video-conference-room',
        crScript.videoTitle || `Conference Room — ${weekLabel}`,
        crScript,
        crVideoId,
        'conference-room'
      );

      results.push({
        format:  'conference-room',
        title:   crScript.videoTitle,
        videoId: crVideoId,
        status:  'processing',
      });
    } catch (err) {
      this._log('error', `Conference Room failed: ${err.message}`);
      await this.reportIssue('high', 'Conference Room Video Failed', err.message);
      results.push({ format: 'conference-room', status: 'failed', error: err.message });
    }

    // ── Step 4: Save weekly production report ──────────────────────────────
    const submitted = results.filter(r => r.status === 'processing').length;

    await this.saveReport(
      'video-production',
      `Weekly Video Production — ${submitted}/2 submitted (week of ${weekLabel})`,
      JSON.stringify({
        weekOf:         weekLabel,
        avatar:         AVATAR_ID,
        voice:          VOICE_ID,
        submitted:      results,
        pendingUpdates,
        outputDir:      OUTPUT_DIR,
      }, null, 2),
      submitted === 2 ? 'normal' : 'high'
    );

    return {
      weekOf:         weekLabel,
      submitted,
      pendingResolved: pendingUpdates.length,
      results,
    };
  }
}

module.exports = HeyGenVideoAgent;

if (require.main === module) {
  const agent = new HeyGenVideoAgent();
  agent.run()
    .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
