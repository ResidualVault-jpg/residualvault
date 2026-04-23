'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const VEO_MODEL = 'veo-3.1-generate-preview';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const BRYAN_REF = path.join(__dirname, '..', 'video', 'bryan-reference.jpg');
const BRYAN_REF_2 = path.join(__dirname, '..', 'video', 'bryan-reference-2.jpg');
const BRYAN_REF_3 = path.join(__dirname, '..', 'video', 'bryan-reference-3.jpg');
const BRYAN_DESC = 'A confident man in his 30s wearing a tailored dark navy suit with a light blue dress shirt, clean shaven, professional appearance, warm confident expression';

const BRAND_STATS = {
  protocols: '156+',
  topApy: '32%',
  apyLabel: 'Live APY Tracking',
  plans: 'Free and PRO Plans',
};

class VeoVideoAgent extends BaseAgent {
  constructor() {
    super({
      name: 'Veo Video Agent',
      role: 'You produce world-class cinematic marketing videos for ResidualVault using Google Veo 3.1 AI video generation. You write scripts, generate video clips with realistic human movement, and coordinate post-production.',
      model: 'claude-sonnet-4-6',
      schedule: '0 15 * * 0',
      timezone: 'America/Denver',
      maxTokens: 4096,
    });
  }

  async _veoGenerate(prompt, referenceImagePath) {
    const url = BASE_URL + '/models/' + VEO_MODEL + ':predictLongRunning?key=' + GEMINI_KEY;
    const body = JSON.stringify({ instances: [{ prompt: prompt }] });
    return new Promise(function(resolve, reject) {
      const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async _veoPoll(operationName, maxWait) {
    maxWait = maxWait || 300000;
    var url = BASE_URL + '/' + operationName + '?key=' + GEMINI_KEY;
    var start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(function(r) { setTimeout(r, 10000); });
      var result = await new Promise(function(resolve, reject) {
        https.get(url, function(res) {
          var data = '';
          res.on('data', function(c) { data += c; });
          res.on('end', function() {
            try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Parse error')); }
          });
        }).on('error', reject);
      });
      if (result.done) return result;
    }
    throw new Error('Veo generation timed out after ' + (maxWait / 1000) + 's');
  }

  async _veoDownload(uri, outputPath) {
    var downloadUrl = uri + '&key=' + GEMINI_KEY;
    return new Promise(function(resolve, reject) {
      var file = fs.createWriteStream(outputPath);
      https.get(downloadUrl, function(res) {
        if (res.statusCode === 301 || res.statusCode === 302) {
          https.get(res.headers.location, function(res2) {
            res2.pipe(file);
            file.on('finish', function() { file.close(); resolve(outputPath); });
          }).on('error', reject);
        } else {
          res.pipe(file);
          file.on('finish', function() { file.close(); resolve(outputPath); });
        }
      }).on('error', reject);
    });
  }

  async writeOfficeJourneyScript() {
    var raw = await this.ask(
      'Write a 4-scene video script for ResidualVault.\n' +
      'PRESENTER: Bryan - ' + BRYAN_DESC + '\n' +
      'FORMAT: Office Journey - Bryan walks through ResidualVault HQ\n\n' +
      'Scene 1 (LOBBY): Bryan walks through a modern corporate lobby with glass walls. Opens with a powerful hook about passive income or crypto staking.\n' +
      'Scene 2 (HALLWAY): Bryan walks down a sleek office hallway. Explains the problem - most people miss the best yields.\n' +
      'Scene 3 (OFFICE): Bryan enters his executive office. Introduces ResidualVault as the solution - ' + BRAND_STATS.protocols + ' protocols tracked.\n' +
      'Scene 4 (DESK): Bryan sits at his desk with a plain laptop in front of him, city skyline visible through floor-to-ceiling windows behind him. The back of the laptop facing the camera is plain and unbranded. Bryan looks directly at the camera. Delivers top yields (up to ' + BRAND_STATS.topApy + ' APY) and CTA to visit ResidualVault.com.\n\n' +
      'Each scene is 15-20 seconds of spoken dialogue.\n' +
      'Output JSON:\n' +
      '{videoTitle: string, scenes: [{scene: 1, location: string, action: string, dialogue: string, videoPrompt: string - detailed Veo prompt describing exactly what Bryan is doing, the environment, camera angle, lighting, cinematic style}]}'
    );
    return this.parseJSON(raw);
  }

  async writeConferenceRoomScript() {
    var raw = await this.ask(
      'Write a single-scene video script for ResidualVault.\n' +
      'PRESENTER: Bryan - ' + BRYAN_DESC + '\n' +
      'FORMAT: Conference Room - Bryan stands at a whiteboard presenting\n\n' +
      'Bryan stands in a professional conference room with a whiteboard behind him showing ResidualVault data.\n' +
      'He delivers a complete 60-90 second pitch covering:\n' +
      '- Hook about passive income\n' +
      '- ' + BRAND_STATS.protocols + ' protocols tracked with ' + BRAND_STATS.apyLabel + '\n' +
      '- Top yields up to ' + BRAND_STATS.topApy + ' APY\n' +
      '- ' + BRAND_STATS.plans + '\n' +
      '- CTA: Visit ResidualVault.com\n\n' +
      'Output JSON:\n' +
      '{videoTitle: string, dialogue: string, videoPrompt: string - detailed Veo prompt describing Bryan presenting in a conference room, whiteboard visible, camera angle, lighting, cinematic}'
    );
    return this.parseJSON(raw);
  }

  async generateSceneClips(scenes) {
    var clips = [];
    var refImage = [BRYAN_REF, BRYAN_REF_2, BRYAN_REF_3].filter(function(p) { return require('fs').existsSync(p); });
    for (var i = 0; i < scenes.length; i++) {
      var scene = scenes[i];
      // Rate limit: wait 15s between scene submissions
      if (i > 0) await new Promise(function(r) { setTimeout(r, 15000); });
      this._log('info', 'Generating scene ' + (i + 1) + '/' + scenes.length + ': ' + (scene.location || 'scene'));

      var prompt = scene.videoPrompt;
      if (prompt.toLowerCase().indexOf('bryan') === -1) {
        prompt = BRYAN_DESC + '. ' + prompt;
      }
      // Add audio/dialogue
      prompt += ' Bryan speaks clearly:  + scene.dialogue.substring(0, 200) + ';

      var op = await this._veoGenerate(prompt, refImage.length > 0 ? refImage : null);
      if (op.error) {
        this._log('error', 'Veo error scene ' + (i + 1) + ': ' + JSON.stringify(op.error));
        clips.push({ scene: i + 1, status: 'failed', error: op.error.message });
        continue;
      }

      this._log('info', 'Scene ' + (i + 1) + ' submitted: ' + op.name);
      var result = await this._veoPoll(op.name, 300000);

      if (result.done && result.response) {
        var samples = result.response.generateVideoResponse.generatedSamples || [];
        if (samples.length > 0) {
          var uri = samples[0].video.uri;
          var clipPath = path.join(__dirname, '..', 'video', 'heygen-clips', 'veo-scene-' + (i + 1) + '-' + Date.now() + '.mp4');
          await this._veoDownload(uri, clipPath);
          this._log('info', 'Scene ' + (i + 1) + ' downloaded: ' + clipPath);
          clips.push({ scene: i + 1, status: 'complete', path: clipPath });
        }
      } else {
        this._log('error', 'Scene ' + (i + 1) + ' failed or timed out');
        clips.push({ scene: i + 1, status: 'failed' });
      }
    }
    return clips;
  }

  async combineClips(clips) {
    var completed = clips.filter(function(c) { return c.status === 'complete'; });
    if (completed.length === 0) throw new Error('No clips to combine');
    if (completed.length === 1) return completed[0].path;
    var inputs = completed.map(function(c) { return '-i ' + c.path; }).join(' ');
    var filterParts = completed.map(function(c, i) { return '[' + i + ':v][' + i + ':a]'; }).join('');
    var filter = filterParts + 'concat=n=' + completed.length + ':v=1:a=1[v][a]';
    var combinedPath = path.join(__dirname, '..', 'video', 'heygen-clips', 'veo-combined-' + Date.now() + '.mp4');
    var cmd = 'ffmpeg -y ' + inputs + ' -filter_complex "' + filter + '" -map "[v]" -map "[a]" ' + combinedPath;
    this._log('info', 'Combining ' + completed.length + ' clips...');
    execSync(cmd, { timeout: 120000 });
    return combinedPath;
  }

  async renderFinalVideo(clips, title) {
    var combinedClip = await this.combineClips(clips);
    var outputPath = path.join(__dirname, '..', 'video', 'output', 'veo-' + Date.now() + '.mp4');

    this._log('info', 'Rendering final video with Remotion: ' + completedClips.length + ' clips');
    var renderVideo = require('../remotion/render').renderVideo;
    await renderVideo({
      heygenClipPath: combinedClip,
      title: title,
      stats: BRAND_STATS,
      cta: 'Visit ResidualVault.com today',
      outputPath: outputPath,
    });

    return outputPath;
  }

  async execute(context) {
    this._log('info', 'Starting weekly video production with Veo 3.1');
    var results = [];

    // Video 1: Office Journey
    try {
      this._log('info', 'Writing Office Journey script...');
      var script1 = await this.writeOfficeJourneyScript();
      if (script1 && script1.scenes) {
        this._log('info', 'Script:  + script1.videoTitle +  - ' + script1.scenes.length + ' scenes');
        var clips1 = await this.generateSceneClips(script1.scenes);
        var completed1 = clips1.filter(function(c) { return c.status === 'complete'; }).length;
        this._log('info', 'Office Journey: ' + completed1 + '/' + script1.scenes.length + ' scenes generated');

        await this.saveContent('video-office-journey', script1.videoTitle, JSON.stringify(script1), null, {
          status: completed1 > 0 ? 'ready_for_review' : 'failed',
          scenes: clips1,
          clipCount: completed1,
        });
        results.push({ format: 'office-journey', title: script1.videoTitle, scenes: completed1, status: completed1 > 0 ? 'complete' : 'failed' });
      }
    } catch (err) {
      this._log('error', 'Office Journey failed: ' + err.message);
      results.push({ format: 'office-journey', status: 'failed', error: err.message });
    }

    // Video 2: Conference Room
    try {
      this._log('info', 'Writing Conference Room script...');
      var script2 = await this.writeConferenceRoomScript();
      if (script2) {
        this._log('info', 'Script:  + script2.videoTitle + ');
        var scene = { location: 'conference-room', action: 'presenting', dialogue: script2.dialogue, videoPrompt: script2.videoPrompt };
        var clips2 = await this.generateSceneClips([scene]);

        await this.saveContent('video-conference-room', script2.videoTitle, JSON.stringify(script2), null, {
          status: clips2[0].status === 'complete' ? 'ready_for_review' : 'failed',
          scenes: clips2,
        });
        results.push({ format: 'conference-room', title: script2.videoTitle, status: clips2[0].status });
      }
    } catch (err) {
      this._log('error', 'Conference Room failed: ' + err.message);
      results.push({ format: 'conference-room', status: 'failed', error: err.message });
    }

    var submitted = results.filter(function(r) { return r.status === 'complete'; }).length;
    await this.saveReport('video-production', 'Weekly Video Production - ' + submitted + '/' + results.length + ' videos (Veo 3.1)', JSON.stringify(results, null, 2));
    return { weekOf: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), submitted: submitted, results: results };
  }
}

module.exports = VeoVideoAgent;

if (require.main === module) {
  var agent = new VeoVideoAgent();
  agent.run().then(function(r) { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(function(e) { console.error(e); process.exit(1); });
}
