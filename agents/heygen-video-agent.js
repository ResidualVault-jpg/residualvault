'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const axios     = require('axios');
const db        = require('../db');

const HEYGEN_BASE = 'https://api.heygen.com';

/**
 * HeyGen Video Agent — Enhanced Production Pipeline
 *
 * Capabilities:
 *  - AI-planned multi-scene video production (Claude plans, HeyGen renders)
 *  - Single & multi-scene video generation via HeyGen v2
 *  - Talking-photo videos (image + voice overlay)
 *  - Video status tracker (polls pending jobs from DB, updates on completion)
 *  - Weekly video series planner (episode arc, topic calendar)
 *  - Subject-matter script writing with scene breakdown
 *  - Scheduled: every Monday at 10 AM
 */
class HeyGenVideoAgent extends BaseAgent {
  constructor() {
    super({
      name:      'HeyGen Video Agent',
      role:      'You are a professional video content director specialising in AI avatar video production. ' +
                 'You plan multi-scene marketing and educational videos for ResidualVault, write compelling scripts, ' +
                 'manage HeyGen production pipelines, and grow a YouTube/social video library that converts viewers into customers.',
      model:     'claude-opus-4-5',
      schedule:  '0 10 * * 1',  // Mondays at 10 AM
      maxTokens: 6144,
    });

    this.apiKey  = process.env.HEYGEN_API_KEY;
    this.avatarId = process.env.HEYGEN_AVATAR_ID || null;
    this.voiceId  = process.env.HEYGEN_VOICE_ID  || null;
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  get _headers() {
    return { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' };
  }

  async _get(path) {
    const { data } = await axios.get(`${HEYGEN_BASE}${path}`, { headers: this._headers });
    return data;
  }

  async _post(path, body) {
    const { data } = await axios.post(`${HEYGEN_BASE}${path}`, body, { headers: this._headers });
    return data;
  }

  // ─── HeyGen resource discovery ────────────────────────────────────────────

  async listAvatars() {
    const res = await this._get('/v2/avatars');
    return res.data?.avatars || [];
  }

  async listVoices() {
    const res = await this._get('/v2/voices');
    return res.data?.voices || [];
  }

  async listTalkingPhotos() {
    const res = await this._get('/v2/talking_photo');
    return res.data?.talking_photos || [];
  }

  /** Resolve first available English voice if none configured */
  async resolveAvatarAndVoice() {
    let { avatarId, voiceId } = this;
    if (!avatarId || !voiceId) {
      const [avatars, voices] = await Promise.all([this.listAvatars(), this.listVoices()]);
      if (!avatarId && avatars.length) avatarId = avatars[0].avatar_id;
      if (!voiceId  && voices.length) {
        voiceId = voices.find(v => v.language === 'en' || v.language === 'English')?.voice_id
                || voices[0]?.voice_id;
      }
    }
    return { avatarId, voiceId };
  }

  // ─── Script & Production Planning ────────────────────────────────────────

  /**
   * Ask Claude to plan a complete multi-scene video production.
   * Returns a structured production plan with scene scripts.
   */
  async planVideoProduction(topic, targetDuration = 90, sceneCount = 3) {
    const raw = await this.ask(`
You are a professional video director planning an AI avatar video for ResidualVault.

TOPIC: "${topic}"
TARGET DURATION: ${targetDuration} seconds
SCENES: ${sceneCount} scenes

Plan a complete video production with this exact JSON structure:

{
  "title": "string (YouTube-optimised, max 70 chars)",
  "description": "string (YouTube description, 200 words, SEO-rich)",
  "tags": ["string"],
  "thumbnail_concept": "string (visual description for thumbnail designer)",
  "total_estimated_seconds": number,
  "scenes": [
    {
      "scene_number": number,
      "duration_seconds": number,
      "script": "string (spoken words only, no stage directions)",
      "background_color": "string (hex, brand-appropriate dark/light)",
      "visual_overlay_text": "string (short on-screen text, max 8 words)",
      "transition": "fade|cut|slide",
      "purpose": "hook|education|proof|cta"
    }
  ],
  "hook": "string (first sentence that grabs attention)",
  "cta": "string (final call to action, mentions ResidualVault.com)",
  "platform_targets": ["YouTube", "LinkedIn", "Instagram Reels"],
  "seo_keywords": ["string"]
}

Brand voice: Confident, empowering, educational — no hype, real value.
Audience: Entrepreneurs and side-hustlers seeking financial freedom.
CTA destination: ResidualVault.com
`);
    return this.parseJSON(raw) || { title: topic, scenes: [{ scene_number: 1, script: raw.substring(0, 500), duration_seconds: targetDuration }] };
  }

  /** Simple single-scene script for shorter videos */
  async writeScript(topic, durationSeconds = 60) {
    const raw = await this.ask(`
Write a professional ${durationSeconds}-second video script for ResidualVault on: "${topic}"

Requirements:
- Conversational, confident tone
- Strong hook in the first sentence
- Clear CTA at the end mentioning ResidualVault.com
- Pure spoken text only, no markdown
- Approx. ${Math.round(durationSeconds * 2.5)} words

Output JSON:
{
  "title": "string",
  "script": "string",
  "hook": "string",
  "cta": "string",
  "estimatedDuration": number
}
`);
    return this.parseJSON(raw) || { title: topic, script: raw.substring(0, 1000) };
  }

  /** Plan a 12-episode YouTube series with episode topics & publishing schedule */
  async planVideoSeries(seriesTheme) {
    const raw = await this.ask(`
Plan a 12-episode YouTube video series for ResidualVault on the theme: "${seriesTheme}"

Output JSON:
{
  "seriesTitle": "string",
  "seriesDescription": "string",
  "targetAudience": "string",
  "publishingCadence": "string",
  "episodes": [
    {
      "episodeNumber": number,
      "title": "string",
      "hook": "string",
      "keyPoints": ["string"],
      "estimatedViews": "string",
      "publishWeek": number
    }
  ],
  "playlistDescription": "string",
  "growthStrategy": "string",
  "monetisationTrigger": "string"
}
`);
    return this.parseJSON(raw) || {};
  }

  // ─── HeyGen Video Submission ──────────────────────────────────────────────

  /**
   * Submit a single-scene video to HeyGen v2.
   * @returns {string} video_id
   */
  async createVideo(script, avatarId, voiceId, title) {
    const payload = {
      video_inputs: [{
        character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
        voice:     { type: 'text', input_text: script, voice_id: voiceId, speed: 1.0 },
        background: { type: 'color', value: '#0f0f1a' },
      }],
      dimension: { width: 1280, height: 720 },
      title,
    };
    const res = await this._post('/v2/video/generate', payload);
    return res.data?.video_id;
  }

  /**
   * Submit a multi-scene video to HeyGen v2.
   * Scenes should come from planVideoProduction().
   */
  async createMultiSceneVideo(plan, avatarId, voiceId) {
    const scenes = plan.scenes || [];

    const video_inputs = scenes.map(scene => ({
      character:  { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
      voice:      { type: 'text', input_text: scene.script, voice_id: voiceId, speed: 1.0 },
      background: { type: 'color', value: scene.background_color || '#0f0f1a' },
    }));

    const payload = {
      video_inputs,
      dimension: { width: 1280, height: 720 },
      title: plan.title,
    };

    const res = await this._post('/v2/video/generate', payload);
    return res.data?.video_id;
  }

  /**
   * Submit a talking-photo video (static image + voice narration).
   */
  async createTalkingPhotoVideo(script, talkingPhotoId, voiceId, title) {
    const payload = {
      video_inputs: [{
        character: { type: 'talking_photo', talking_photo_id: talkingPhotoId },
        voice:     { type: 'text', input_text: script, voice_id: voiceId, speed: 1.0 },
        background: { type: 'color', value: '#1a1a2e' },
      }],
      dimension: { width: 1280, height: 720 },
      title,
    };
    const res = await this._post('/v2/video/generate', payload);
    return res.data?.video_id;
  }

  // ─── Status Tracking ──────────────────────────────────────────────────────

  /** Poll a single video until completed/failed (max 30 min) */
  async pollVideoStatus(videoId, maxWaitMs = 1800000) {
    const pollInterval = 15000;
    const deadline     = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollInterval));
      const res    = await this._get(`/v1/video_status.get?video_id=${videoId}`);
      const status = res.data?.status;
      this._log('info', `Video ${videoId} → ${status}`);

      if (status === 'completed') return { status: 'completed', url: res.data?.video_url };
      if (status === 'failed')    return { status: 'failed', error: res.data?.error };
    }
    return { status: 'timeout' };
  }

  /**
   * Check all previously submitted videos still in 'processing' state.
   * Queries the DB for content with status=processing, polls HeyGen, updates DB.
   */
  async checkPendingVideos() {
    // Pull processing video records from generated_content table
    const rows = db.db.prepare(`
      SELECT id, title, metadata
      FROM   generated_content
      WHERE  content_type = 'video'
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
        const res    = await this._get(`/v1/video_status.get?video_id=${meta.videoId}`);
        const status = res.data?.status;

        if (status === 'completed' || status === 'failed') {
          meta.status      = status;
          meta.checkedAt   = new Date().toISOString();
          if (status === 'completed') meta.videoUrl = res.data?.video_url;
          if (status === 'failed')    meta.error    = res.data?.error;

          db.db.prepare(`UPDATE generated_content SET url = ?, metadata = ? WHERE id = ?`)
            .run(meta.videoUrl || null, JSON.stringify(meta), row.id);

          this._log('info', `Video "${row.title}" → ${status}${meta.videoUrl ? ' — ' + meta.videoUrl : ''}`);
          updates.push({ id: row.id, title: row.title, status, url: meta.videoUrl });
        }
      } catch (err) {
        this._log('error', `Status check failed for video ${meta.videoId}: ${err.message}`);
      }
    }

    return updates;
  }

  // ─── Main Execute ─────────────────────────────────────────────────────────

  async execute(context = {}) {
    if (!this.apiKey) {
      this._log('warning', 'HEYGEN_API_KEY not set — skipping video production');
      return { skipped: true, reason: 'missing_api_key' };
    }

    // Step 1 — Check status of any previously submitted videos
    let pendingUpdates = [];
    try {
      pendingUpdates = await this.checkPendingVideos();
      this._log('info', `Pending video check: ${pendingUpdates.length} status update(s)`);
    } catch (err) {
      this._log('error', `Pending video check error: ${err.message}`);
    }

    // Step 2 — Resolve avatar & voice
    let avatarId, voiceId;
    try {
      ({ avatarId, voiceId } = await this.resolveAvatarAndVoice());
      this._log('info', `Avatar: ${avatarId} | Voice: ${voiceId}`);
    } catch (err) {
      this._log('error', `Cannot resolve avatar/voice: ${err.message}`);
      return { skipped: true, reason: 'avatar_voice_error', error: err.message };
    }

    // Step 3 — Produce this week's videos (multi-scene)
    const topics = context.topics || [
      'How ResidualVault Builds Passive Income on Autopilot',
      'Top 3 Digital Marketing Tactics That Generate Residual Revenue',
    ];

    const results = [];

    for (const topic of topics.slice(0, 2)) {
      try {
        // Plan full multi-scene production
        const plan = await this.planVideoProduction(topic, 90, 3);
        this._log('info', `Production plan ready: "${plan.title}" (${plan.scenes?.length || 1} scenes)`);

        // Submit to HeyGen
        const videoId = plan.scenes?.length > 1
          ? await this.createMultiSceneVideo(plan, avatarId, voiceId)
          : await this.createVideo(plan.scenes[0]?.script || topic, avatarId, voiceId, plan.title);

        this._log('info', `Video job submitted: ${videoId}`);

        await this.saveContent(
          'video',
          plan.title,
          JSON.stringify(plan, null, 2),
          null,
          {
            videoId,
            topic,
            status:      'processing',
            sceneCount:  plan.scenes?.length || 1,
            tags:        plan.tags,
            seoKeywords: plan.seo_keywords,
            submittedAt: new Date().toISOString(),
          }
        );

        results.push({ topic, videoId, title: plan.title, sceneCount: plan.scenes?.length || 1, status: 'submitted' });
      } catch (err) {
        this._log('error', `Video creation failed for "${topic}": ${err.message}`);
        await this.reportIssue('medium', 'Video Creation Failed', `Topic: ${topic} — ${err.message}`);
        results.push({ topic, status: 'failed', error: err.message });
      }
    }

    // Step 4 — Plan a video series (every Monday)
    let seriesPlan = null;
    try {
      seriesPlan = await this.planVideoSeries('Building Passive Income with Digital Marketing');
      await this.saveContent('video-series-plan', seriesPlan.seriesTitle || 'Video Series Plan', JSON.stringify(seriesPlan, null, 2));
      this._log('info', `Series plan saved: "${seriesPlan.seriesTitle}" (${seriesPlan.episodes?.length || 0} episodes)`);
    } catch (err) {
      this._log('error', `Series planning failed: ${err.message}`);
    }

    await this.saveReport(
      'video-production',
      `Weekly Video Production — ${results.filter(r => r.status === 'submitted').length} video(s) queued`,
      JSON.stringify({ submitted: results, pendingUpdates, series: seriesPlan?.seriesTitle }, null, 2)
    );

    return {
      submitted:     results.filter(r => r.status === 'submitted').length,
      pendingUpdates: pendingUpdates.length,
      series:         seriesPlan?.seriesTitle,
      results,
    };
  }
}

module.exports = HeyGenVideoAgent;

if (require.main === module) {
  const agent = new HeyGenVideoAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
