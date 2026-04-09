'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const axios     = require('axios');

const HEYGEN_BASE = 'https://api.heygen.com';

class HeyGenVideoAgent extends BaseAgent {
  constructor() {
    super({
      name:      'HeyGen Video Agent',
      role:      'You are a video content strategist specializing in AI avatar video production. You create compelling scripts and manage video production pipelines using HeyGen\'s API to produce professional marketing and educational videos for ResidualVault.',
      model:     'claude-opus-4-5',
      schedule:  '0 10 * * 1',  // Mondays at 10 AM
      maxTokens: 4096,
    });

    this.apiKey = process.env.HEYGEN_API_KEY;
    this.avatarId = process.env.HEYGEN_AVATAR_ID || null;
    this.voiceId  = process.env.HEYGEN_VOICE_ID  || null;
  }

  get headers() {
    return {
      'X-Api-Key':    this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  async listAvatars() {
    const { data } = await axios.get(`${HEYGEN_BASE}/v2/avatars`, { headers: this.headers });
    return data.data?.avatars || [];
  }

  async listVoices() {
    const { data } = await axios.get(`${HEYGEN_BASE}/v2/voices`, { headers: this.headers });
    return data.data?.voices || [];
  }

  /**
   * Submit a video generation job to HeyGen.
   * @returns {string} video_id
   */
  async createVideo(script, avatarId, voiceId, title) {
    const payload = {
      video_inputs: [
        {
          character: {
            type:      'avatar',
            avatar_id: avatarId,
            avatar_style: 'normal',
          },
          voice: {
            type:     'text',
            input_text: script,
            voice_id:   voiceId,
            speed:      1.0,
          },
          background: {
            type:  'color',
            value: '#1a1a2e',
          },
        },
      ],
      dimension: { width: 1280, height: 720 },
      title,
    };

    const { data } = await axios.post(`${HEYGEN_BASE}/v2/video/generate`, payload, { headers: this.headers });
    return data.data?.video_id;
  }

  /** Poll until video is ready (max 30 min) */
  async pollVideoStatus(videoId, maxWaitMs = 1800000) {
    const pollInterval = 15000;
    const deadline     = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollInterval));
      const { data } = await axios.get(
        `${HEYGEN_BASE}/v1/video_status.get?video_id=${videoId}`,
        { headers: this.headers }
      );
      const status = data.data?.status;
      this._log('info', `Video ${videoId} status: ${status}`);

      if (status === 'completed') return { status: 'completed', url: data.data?.video_url };
      if (status === 'failed')    return { status: 'failed',    error: data.data?.error };
    }

    return { status: 'timeout' };
  }

  /** Ask Claude to write a professional video script */
  async writeScript(topic, durationSeconds = 60) {
    const raw = await this.ask(`
Write a professional ${durationSeconds}-second video script for ResidualVault on this topic: "${topic}"

Requirements:
- Conversational, confident tone
- Opens with a strong hook
- Includes a clear CTA at the end (visit ResidualVault.com)
- No markdown, pure spoken text only
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

  async execute(context = {}) {
    if (!this.apiKey) {
      this._log('warning', 'HEYGEN_API_KEY not set — skipping');
      return { skipped: true, reason: 'missing_api_key' };
    }

    // Determine avatar and voice
    let avatarId = this.avatarId;
    let voiceId  = this.voiceId;

    if (!avatarId || !voiceId) {
      try {
        const [avatars, voices] = await Promise.all([this.listAvatars(), this.listVoices()]);
        if (!avatarId && avatars.length) avatarId = avatars[0].avatar_id;
        if (!voiceId  && voices.length)  voiceId  = voices.find(v => v.language === 'English')?.voice_id || voices[0]?.voice_id;
        this._log('info', `Using avatar: ${avatarId}, voice: ${voiceId}`);
      } catch (err) {
        this._log('error', `Failed to fetch avatars/voices: ${err.message}`);
        return { skipped: true, reason: 'api_error', error: err.message };
      }
    }

    const topics = context.topics || [
      'How ResidualVault Helps You Build Passive Income Streams',
      'Top 5 Digital Marketing Strategies for Entrepreneurs',
    ];

    const results = [];

    for (const topic of topics.slice(0, 2)) { // limit to 2 per run
      try {
        const scriptData = await this.writeScript(topic, 60);
        this._log('info', `Script ready: ${scriptData.title}`);

        const videoId = await this.createVideo(scriptData.script, avatarId, voiceId, scriptData.title);
        this._log('info', `Video job submitted: ${videoId}`);

        // Don't block — save job for status check on next run
        await this.saveContent(
          'video',
          scriptData.title,
          scriptData.script,
          null,
          { videoId, topic, status: 'processing', submittedAt: new Date().toISOString() }
        );

        results.push({ topic, videoId, title: scriptData.title, status: 'submitted' });
      } catch (err) {
        this._log('error', `Video creation failed for "${topic}": ${err.message}`);
        await this.reportIssue('medium', 'Video Creation Failed', `Topic: ${topic} — ${err.message}`);
        results.push({ topic, success: false, error: err.message });
      }
    }

    await this.saveReport(
      'video-production',
      `Weekly Video Production — ${results.length} videos queued`,
      JSON.stringify(results, null, 2)
    );

    return { queued: results.length, results };
  }
}

module.exports = HeyGenVideoAgent;

if (require.main === module) {
  const agent = new HeyGenVideoAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
