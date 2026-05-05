'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
var BaseAgent = require('./base-agent');
var fs = require('fs');
var path = require('path');
var https = require('https');
var crypto = require('crypto');
var execSync = require('child_process').execSync;

// QA Pipeline
var briefSchema = require('./lib/video-brief-schema');
var validateVideoBrief = briefSchema.validateVideoBrief;
var VideoQAError = briefSchema.VideoQAError;
var scriptQA = require('./lib/video-script-qa');
var runScriptQA = scriptQA.runScriptQA;
var clipQA = require('./lib/video-clip-qa');
var runClipQA = clipQA.runClipQA;
var buildRetryPrompt = clipQA.buildRetryPrompt;
var assemblyQA = require('./lib/video-assembly-qa');
var runAssemblyQA = assemblyQA.runAssemblyQA;

var GEMINI_KEY = process.env.GEMINI_API_KEY;
var VEO_MODEL = 'veo-3.1-generate-preview';
var BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

var BRYAN_DESC = 'A confident man in his 30s wearing a tailored dark navy suit with a light blue dress shirt, clean shaven, professional appearance, warm confident expression';

var BRAND_STATS = {
  protocols: '156+',
  topApy: '32%',
  apyLabel: 'Live APY Tracking',
  plans: 'Free and PRO Plans',
};

var VISUAL_DICTIONARY = [
  'corporate', 'lobby', 'glass', 'hallway', 'office', 'executive', 'desk',
  'laptop', 'skyline', 'conference', 'whiteboard', 'professional', 'modern',
  'cinematic', 'walking', 'sitting', 'standing', 'presenting', 'speaking',
  'camera', 'lighting', 'window', 'city', 'suit', 'building'
];

function extractVisualKeywords(prompt, location) {
  var keywords = [];
  if (location) keywords.push(location.toLowerCase().replace(/[^a-z\s]/g, '').trim());
  var promptLower = (prompt || '').toLowerCase();
  for (var i = 0; i < VISUAL_DICTIONARY.length; i++) {
    var w = VISUAL_DICTIONARY[i];
    if (promptLower.indexOf(w) !== -1 && keywords.indexOf(w) === -1) {
      keywords.push(w);
    }
  }
  while (keywords.length < 3) keywords.push('professional');
  return keywords.slice(0, 5);
}

class VeoVideoAgent extends BaseAgent {
  constructor() {
    super({
      name: 'Veo Video Agent',
      role: 'You produce world-class cinematic marketing videos for ResidualVault using Google Veo 3.1 AI video generation. You write scripts, generate video clips with realistic human movement, and coordinate post-production.',
      model: 'claude-sonnet-4-6',
      schedule: null, // PAUSED — was '0 15 * * 0',
      timezone: 'America/Denver',
      maxTokens: 4096,
    });
  }

  // ─── Veo API Methods (unchanged) ──────────────────────────────────────────

  async _veoGenerate(prompt) {
    var url = BASE_URL + '/models/' + VEO_MODEL + ':predictLongRunning?key=' + GEMINI_KEY;
    var body = JSON.stringify({ instances: [{ prompt: prompt }] });
    return new Promise(function(resolve, reject) {
      var req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, function(res) {
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

  // ─── Script Generation ────────────────────────────────────────────────────

  async writeOfficeJourneyScript() {
    var raw = await this.ask(
      'Write an 8-scene video script for ResidualVault.\n' +
      'PRESENTER: The presenter - ' + BRYAN_DESC + '\n' +
      'FORMAT: Office Journey - the presenter walks through ResidualVault HQ\n\n' +
      'CRITICAL: Each scene will be a single ~8-second video clip generated by AI.\n' +
      'WORD COUNT: Each scene must have 15-20 words of dialogue (about 8 seconds of speaking).\n' +
      'Total across all 8 scenes: 140-155 words. DO NOT go below 140 or exceed 155 words.\n\n' +
      'COMPLIANCE: Do NOT mention any specific APY numbers or percentage yields in dialogue. Say "top-performing yields", "industry-leading returns", or "some of the highest returns in DeFi" instead. Specific numbers will be added as on-screen graphics.\n\n' +
      'Scene 1 (LOBBY ENTRANCE): The presenter walks into a modern corporate lobby with glass walls. Delivers a punchy hook about passive income. (15-20 words)\n' +
      'Scene 2 (LOBBY WIDE): Wide shot of the presenter walking through the lobby. Teases the problem — most people miss top yields. (15-20 words)\n' +
      'Scene 3 (HALLWAY START): The presenter walks down a sleek office hallway. Names the specific problem — scattered protocols. (15-20 words)\n' +
      'Scene 4 (HALLWAY MID): Medium shot of the presenter in hallway. Introduces ResidualVault by name. (15-20 words)\n' +
      'Scene 5 (OFFICE DOOR): The presenter enters his executive office. States key stat — over 150 protocols tracked across every major blockchain. (15-20 words)\n' +
      'Scene 6 (OFFICE INTERIOR): Inside the office, presenter gestures confidently. Explains real-time yield comparison. (15-20 words)\n' +
      'Scene 7 (DESK): The presenter sits at his desk, plain laptop visible, city skyline behind. Mentions industry-leading yields available through the platform (do NOT state a specific APY number — just say "top-performing yields" or "industry-leading returns"). (15-20 words)\n' +
      'Scene 8 (DESK CLOSE): Close-up of presenter at desk looking at camera. CTA — visit ResidualVault.com and start free today. (15-20 words)\n\n' +
      'Output JSON:\n' +
      '{videoTitle: string, scenes: [{scene: 1, location: string, action: string, dialogue: string, videoPrompt: string - detailed Veo prompt for an 8-second clip. Describe the presenter, environment, camera angle, lighting, cinematic style. DO NOT use character names — use "the presenter" or "he".}]}'
    );
    return this.parseJSON(raw);
  }

  async writeConferenceRoomScript() {
    var raw = await this.ask(
      'Write a 10-scene video script for ResidualVault.\n' +
      'PRESENTER: The presenter - ' + BRYAN_DESC + '\n' +
      'FORMAT: Conference Room Pitch - the presenter stands at a whiteboard presenting\n\n' +
      'CRITICAL: Each scene will be a single ~8-second video clip generated by AI.\n' +
      'WORD COUNT: Each scene must have 15-20 words of dialogue (about 8 seconds of speaking).\n' +
      'Total across all 10 scenes: 160-190 words. DO NOT exceed 190 words.\n\n' +
      'COMPLIANCE: Do NOT mention any specific APY numbers or percentage yields in dialogue. Say "top-performing yields", "industry-leading returns", or "some of the highest returns in DeFi" instead. Specific numbers will be added as on-screen graphics.\n\n' +
      'Setting: A professional conference room with a whiteboard behind the presenter.\n' +
      'Scene 1: Hook — passive income opportunity. Presenter stands at whiteboard.\n' +
      'Scene 2: The problem — yields are scattered across dozens of protocols.\n' +
      'Scene 3: Introduce ResidualVault by name. Presenter gestures to whiteboard.\n' +
      'Scene 4: Key stat — ' + BRAND_STATS.protocols + ' protocols tracked in real time.\n' +
      'Scene 5: ' + BRAND_STATS.apyLabel + ' — explain the comparison feature.\n' +
      'Scene 6: Top yields — mention industry-leading returns (do NOT state a specific APY number — just say "top-performing yields" or "some of the highest returns in DeFi").\n' +
      'Scene 7: How it works — automated alerts when better yields appear.\n' +
      'Scene 8: ' + BRAND_STATS.plans + ' — something for every investor.\n' +
      'Scene 9: Social proof or trust statement.\n' +
      'Scene 10: CTA — Visit ResidualVault.com, start free today. Presenter looks at camera.\n\n' +
      'Output JSON:\n' +
      '{videoTitle: string, scenes: [{scene: 1, location: string, action: string, dialogue: string, videoPrompt: string - detailed Veo prompt for an 8-second clip. Describe the presenter at the whiteboard, camera angle, lighting. DO NOT use character names — use "the presenter" or "he".}]}'
    );
    return this.parseJSON(raw);
  }

  // ─── QA Pipeline: Brief Builder ───────────────────────────────────────────

  buildVideoBrief(title, purpose, scenes, targetDurationSeconds) {
    var briefScenes = scenes.map(function(s, i) {
      var dialogue = s.dialogue || '';
      var words = dialogue.split(/\s+/).filter(function(w) { return w.length > 0; });
      var prompt = s.videoPrompt || s.geminiPrompt || '';

      // Inject avatar consistency into every Gemini prompt
      var fullPrompt = prompt;
      if (fullPrompt.toLowerCase().indexOf('same man') === -1 && fullPrompt.toLowerCase().indexOf('same person') === -1) {
        fullPrompt = BRYAN_DESC + '. ' + fullPrompt;
      }
      // Inject full dialogue into the Gemini prompt — Veo needs complete text for lip sync
      if (dialogue && fullPrompt.indexOf(dialogue.substring(0, 30)) === -1) {
        fullPrompt += ' The presenter speaks clearly and naturally: "' + dialogue + '"';
      }

      return {
        sceneIndex: i,
        description: s.action || s.location || ('Scene ' + (i + 1)),
        durationSeconds: 8,
        dialogue: dialogue,
        wordCount: words.length,
        avatarPresent: true,
        visualKeywords: extractVisualKeywords(prompt, s.location),
        transitionIn: i === 0 ? 'fade-from-black' : 'crossfade',
        geminiPrompt: fullPrompt
      };
    });

    var totalWords = briefScenes.reduce(function(sum, s) { return sum + s.wordCount; }, 0);
    var estimatedAudio = Math.round(totalWords / 2.5);
    // Target = whichever is larger: audio estimate or clip-based duration
    // Veo clips are ~8s each; Remotion adds ~8-10s for intro/outro/transitions
    var clipBasedDuration = briefScenes.length * 8;
    var effectiveTarget = Math.max(estimatedAudio, clipBasedDuration);
    var sceneDuration = Math.max(Math.round(clipBasedDuration / briefScenes.length), 3);
    briefScenes.forEach(function(s) { s.durationSeconds = sceneDuration; });

    return {
      jobId: crypto.randomUUID(),
      brand: 'ResidualVault',
      title: title,
      purpose: purpose,
      avatar: {
        count: 1,
        description: BRYAN_DESC,
        voiceStyle: 'professional',
        consistencyInstruction: BRYAN_DESC + '. This SAME person must appear in EVERY scene. No other people in frame.'
      },
      duration: {
        targetSeconds: effectiveTarget,
        minSeconds: Math.round(effectiveTarget * 0.8),
        maxSeconds: Math.round(effectiveTarget * 1.2)
      },
      audio: {
        scriptWordCount: totalWords,
        estimatedAudioSeconds: estimatedAudio,
        musicRequired: true,
        voiceoverRequired: true
      },
      scenes: briefScenes,
      constraints: {
        maxRetriesPerScene: 3,
        maxTotalRetries: 5,
        qaGateRequired: true,
        humanReviewRequired: true
      },
      meta: {
        targetPlatforms: ['youtube', 'twitter', 'linkedin'],
        createdAt: new Date().toISOString(),
        agentVersion: '3.0.0'
      }
    };
  }

  // ─── QA Pipeline: Failure Logger ──────────────────────────────────────────

  async writeQAFailure(brief, qaError) {
    await this.saveContent('video_qa_failure', 'QA FAILED: ' + brief.title + ' [' + qaError.component + ']',
      JSON.stringify({
        jobId: brief.jobId,
        component: qaError.component,
        errors: qaError.errors,
        brief: brief
      }),
      null,
      {
        status: 'qa_failed',
        qaComponent: qaError.component,
        errorCount: qaError.errors.length,
        failedAt: new Date().toISOString()
      }
    );
  }

  // ─── QA-Gated Scene Generation ────────────────────────────────────────────

  async generateSceneWithQA(scene, brief) {
    var clipPath = null;
    var lastErrors = [];
    var currentPrompt = scene.geminiPrompt;

    for (var attempt = 1; attempt <= brief.constraints.maxRetriesPerScene; attempt++) {
      // Rate limit between attempts
      if (attempt > 1) await new Promise(function(r) { setTimeout(r, 15000); });

      this._log('info', 'Generating clip for scene ' + scene.sceneIndex + ' (attempt ' + attempt + ')', {
        jobId: brief.jobId, sceneIndex: scene.sceneIndex, attempt: attempt
      });

      // Call Gemini
      var op;
      try {
        op = await this._veoGenerate(currentPrompt);
      } catch (genErr) {
        lastErrors = ['Gemini API call failed: ' + genErr.message];
        this._log('error', 'Gemini API error on scene ' + scene.sceneIndex + ' attempt ' + attempt, {
          error: genErr.message
        });
        continue;
      }

      if (op.error) {
        lastErrors = ['Gemini returned error: ' + (op.error.message || JSON.stringify(op.error))];
        this._log('error', 'Veo error scene ' + scene.sceneIndex + ' attempt ' + attempt, {
          error: op.error
        });
        continue;
      }

      // Poll for completion
      var result;
      try {
        this._log('info', 'Scene ' + scene.sceneIndex + ' submitted: ' + op.name);
        result = await this._veoPoll(op.name, 300000);
      } catch (pollErr) {
        lastErrors = ['Polling failed or timed out: ' + pollErr.message];
        this._log('error', 'Veo poll failed scene ' + scene.sceneIndex, { error: pollErr.message });
        continue;
      }

      if (!result.done || !result.response) {
        lastErrors = ['Veo generation did not complete'];
        this._log('error', 'Scene ' + scene.sceneIndex + ' did not complete');
        continue;
      }

      var samples = result.response.generateVideoResponse
        ? result.response.generateVideoResponse.generatedSamples || []
        : [];
      if (samples.length === 0) {
        lastErrors = ['Veo returned no video samples'];
        this._log('error', 'Scene ' + scene.sceneIndex + ' returned 0 samples');
        continue;
      }

      // Download clip
      var uri = samples[0].video.uri;
      clipPath = path.join(__dirname, '..', 'video', 'heygen-clips',
        'veo-scene-' + scene.sceneIndex + '-' + Date.now() + '.mp4');
      try {
        await this._veoDownload(uri, clipPath);
        this._log('info', 'Scene ' + scene.sceneIndex + ' downloaded: ' + clipPath);
      } catch (dlErr) {
        lastErrors = ['Download failed: ' + dlErr.message];
        this._log('error', 'Download failed scene ' + scene.sceneIndex, { error: dlErr.message });
        continue;
      }

      // COMPONENT 3: Clip QA
      try {
        var qaResult = runClipQA(clipPath, scene, brief);
        this._log('info', 'Scene ' + scene.sceneIndex + ' clip passed QA on attempt ' + attempt, {
          jobId: brief.jobId, sceneIndex: scene.sceneIndex, attempt: attempt,
          metrics: qaResult.metrics
        });
        return { passed: true, clipPath: clipPath, metrics: qaResult.metrics, attempts: attempt };
      } catch (clipErr) {
        if (clipErr instanceof VideoQAError) {
          lastErrors = clipErr.errors;
          this._log('warn', 'Scene ' + scene.sceneIndex + ' clip FAILED QA (attempt ' + attempt + ')', {
            jobId: brief.jobId, sceneIndex: scene.sceneIndex, attempt: attempt,
            errors: lastErrors
          });
          if (attempt < brief.constraints.maxRetriesPerScene) {
            currentPrompt = buildRetryPrompt(scene, lastErrors, attempt + 1);
            this._log('info', 'Built targeted retry prompt for scene ' + scene.sceneIndex);
          }
        } else {
          throw clipErr;
        }
      }
    }

    // All retries exhausted
    return { passed: false, errors: lastErrors, attempts: brief.constraints.maxRetriesPerScene };
  }

  // ─── Clip Combination ─────────────────────────────────────────────────────

  combineClips(approvedClips) {
    if (approvedClips.length === 0) throw new Error('No clips to combine');
    if (approvedClips.length === 1) return approvedClips[0].clipPath;

    var inputs = approvedClips.map(function(c) { return '-i ' + c.clipPath; }).join(' ');
    var filterParts = approvedClips.map(function(c, i) { return '[' + i + ':v][' + i + ':a]'; }).join('');
    var filter = filterParts + 'concat=n=' + approvedClips.length + ':v=1:a=1[v][a]';
    var combinedPath = path.join(__dirname, '..', 'video', 'heygen-clips', 'veo-combined-' + Date.now() + '.mp4');
    var cmd = 'ffmpeg -y ' + inputs + ' -filter_complex "' + filter + '" -map "[v]" -map "[a]" ' + combinedPath;

    this._log('info', 'Combining ' + approvedClips.length + ' QA-approved clips...');
    execSync(cmd, { timeout: 120000 });
    return combinedPath;
  }

  // ─── Remotion Render ──────────────────────────────────────────────────────

  async renderFinalVideo(approvedClips, title) {
    var combinedClip = this.combineClips(approvedClips);
    var outputPath = path.join(__dirname, '..', 'video', 'output', 'veo-' + Date.now() + '.mp4');

    this._log('info', 'Rendering final video with Remotion: ' + approvedClips.length + ' clips');
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

  // ─── Full QA Pipeline for One Video ───────────────────────────────────────

  async produceVideoWithQA(scriptFn, format, purpose, targetDuration) {
    var self = this;
    var totalAttempts = 0;
    var qaFailures = 0;

    // Step 1: Generate script
    this._log('info', 'Writing ' + format + ' script...');
    var script = await scriptFn.call(this);
    if (!script) {
      return { format: format, status: 'failed', error: 'Script generation returned null' };
    }

    // Normalize scenes array (conference room has single scene)
    var rawScenes;
    var title;
    if (script.scenes && Array.isArray(script.scenes)) {
      rawScenes = script.scenes;
      title = script.videoTitle || format;
    } else if (script.dialogue && script.videoPrompt) {
      rawScenes = [{
        location: 'conference-room',
        action: 'presenting at whiteboard',
        dialogue: script.dialogue,
        videoPrompt: script.videoPrompt
      }];
      title = script.videoTitle || format;
    } else {
      return { format: format, status: 'failed', error: 'Script had unexpected structure' };
    }

    this._log('info', 'Script: ' + title + ' - ' + rawScenes.length + ' scenes');

    // Step 2: Build brief
    var brief = this.buildVideoBrief(title, purpose, rawScenes, targetDuration);

    // COMPONENT 1: Brief validation
    try {
      validateVideoBrief(brief);
      this._log('info', 'Video brief passed pre-flight validation', { jobId: brief.jobId });
    } catch (err) {
      if (err instanceof VideoQAError) {
        this._log('error', 'BRIEF VALIDATION FAILED — run aborted before Gemini call', {
          jobId: brief.jobId, errors: err.errors, component: err.component
        });
        await self.writeQAFailure(brief, err);
        return { format: format, title: title, status: 'qa_failed', component: 'brief-schema', errors: err.errors };
      }
      throw err;
    }

    // COMPONENT 2: Script QA
    try {
      var scriptResult = await runScriptQA(brief, process.env.ANTHROPIC_API_KEY);
      this._log('info', 'Script QA passed', {
        jobId: brief.jobId,
        warnings: scriptResult.warnings.length,
        assessment: scriptResult.assessment
      });
    } catch (err) {
      if (err instanceof VideoQAError) {
        qaFailures++;
        this._log('error', 'SCRIPT QA FAILED — run aborted before Gemini call', {
          jobId: brief.jobId, errors: err.errors, component: err.component
        });
        await self.writeQAFailure(brief, err);
        return { format: format, title: title, status: 'qa_failed', component: 'script-qa', errors: err.errors };
      }
      throw err;
    }

    // ── APPROVAL GATE ──────────────────────────────────────────────────────
    // Save the QA-approved brief to the dashboard for human approval.
    // NO Veo clips are generated until the owner clicks Approve.
    var sceneSummary = brief.scenes.map(function(s) {
      return 'Scene ' + s.sceneIndex + ' (' + s.durationSeconds + 's): ' + s.description +
        '\n  Dialogue: "' + (s.dialogue || '[B-roll]') + '"';
    }).join('\n\n');

    var estCost = (brief.scenes.length * 3.5).toFixed(0);

    await this.saveContent('video-script-' + format, title, JSON.stringify({
      brief: brief,
      format: format,
      purpose: purpose,
      targetDuration: targetDuration,
      sceneSummary: sceneSummary,
      scriptResult: { warnings: scriptResult.warnings, assessment: scriptResult.assessment }
    }), null, {
      status: 'awaiting_veo_approval',
      jobId: brief.jobId,
      format: format,
      sceneCount: brief.scenes.length,
      estimatedCost: 'Approx $' + estCost + ' for ' + brief.scenes.length + ' Veo clips',
      totalWords: brief.audio.scriptWordCount,
      estimatedDuration: brief.duration.targetSeconds + 's'
    });

    this._log('info', 'Script saved for approval: ' + title + ' (' + brief.scenes.length + ' scenes, ~$' + estCost + '). Waiting for owner approval before Veo generation.', {
      jobId: brief.jobId, format: format
    });

    return {
      format: format,
      title: title,
      status: 'awaiting_approval',
      jobId: brief.jobId,
      scenes: brief.scenes.length,
      estimatedCost: '$' + estCost
    };
  }

  // ─── Phase 2: Generate Veo clips for an approved script ─────────────────

  async generateApprovedVideo(contentId) {
    var self = this;
    var db = require('../db');
    var row = (await db.query('SELECT * FROM generated_content WHERE id = $1', [contentId])).rows[0];
    if (!row) throw new Error('Content ID ' + contentId + ' not found');

    var saved = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
    var brief = saved.brief;
    var format = saved.format;
    var title = row.title;
    var totalAttempts = 0;
    var qaFailures = 0;

    this._log('info', 'Owner approved video generation: ' + title + ' (' + brief.scenes.length + ' scenes)');
    await db.updateContentReview(contentId, 'generating', { approvedAt: new Date().toISOString() });

    // COMPONENT 3: Scene-by-scene generation with per-clip QA
    var approvedClips = [];
    for (var i = 0; i < brief.scenes.length; i++) {
      var scene = brief.scenes[i];
      if (i > 0) await new Promise(function(r) { setTimeout(r, 15000); });

      var sceneResult = await this.generateSceneWithQA(scene, brief);
      totalAttempts += sceneResult.attempts;

      if (!sceneResult.passed) {
        qaFailures++;
        this._log('error', 'Scene ' + scene.sceneIndex + ' failed all attempts', {
          jobId: brief.jobId, sceneIndex: scene.sceneIndex, errors: sceneResult.errors
        });
        await db.updateContentReview(contentId, 'veo_failed', { error: sceneResult.errors.join('; ') });
        return { status: 'veo_failed', scene: scene.sceneIndex, errors: sceneResult.errors };
      }

      approvedClips.push({
        sceneIndex: scene.sceneIndex,
        clipPath: sceneResult.clipPath,
        metrics: sceneResult.metrics
      });
    }

    this._log('info', 'All ' + approvedClips.length + ' scenes passed clip QA — rendering with Remotion');

    // Render with Remotion
    var finalVideoPath;
    try {
      finalVideoPath = await this.renderFinalVideo(approvedClips, title);
    } catch (renderErr) {
      this._log('error', 'Remotion render failed', { error: renderErr.message });
      await db.updateContentReview(contentId, 'render_failed', { error: renderErr.message });
      return { status: 'render_failed', error: renderErr.message };
    }

    // COMPONENT 4: Assembly QA
    try {
      var assemblyResult = runAssemblyQA(finalVideoPath, brief);
      this._log('info', 'Final assembly QA passed', { metrics: assemblyResult.metrics });
    } catch (err) {
      if (err instanceof VideoQAError) {
        this._log('error', 'Assembly QA failed', { errors: err.errors });
        await db.updateContentReview(contentId, 'assembly_qa_failed', { errors: err.errors });
        return { status: 'qa_failed', component: 'assembly-qa', errors: err.errors };
      }
      throw err;
    }

    // All QA gates passed — save final video for review
    await this.saveContent('video-' + format, title, JSON.stringify({
      brief: brief,
      clips: approvedClips.map(function(c) { return { sceneIndex: c.sceneIndex, clipPath: c.clipPath, metrics: c.metrics }; }),
      finalVideoPath: finalVideoPath
    }), null, {
      status: 'pending_review',
      jobId: brief.jobId,
      totalAttempts: totalAttempts,
      scenesGenerated: approvedClips.length,
      finalVideoPath: finalVideoPath,
      sourceApprovalId: contentId
    });

    await db.updateContentReview(contentId, 'video_generated', { finalVideoPath: finalVideoPath });
    this._log('info', 'Video generated and queued for final review: ' + title);

    return {
      status: 'complete',
      title: title,
      scenes: approvedClips.length,
      totalAttempts: totalAttempts,
      finalVideoPath: finalVideoPath
    };
  }

  // ─── Main Execution ───────────────────────────────────────────────────────

  async execute(context) {
    this._log('info', 'Starting weekly video production with Veo 3.1 + QA Pipeline v3.0');
    var results = [];

    // Video 1: Office Journey (8 scenes × ~8s = ~64s)
    try {
      var result1 = await this.produceVideoWithQA(
        this.writeOfficeJourneyScript, 'office-journey', 'marketing', 64
      );
      results.push(result1);
    } catch (err) {
      this._log('error', 'Office Journey failed: ' + err.message);
      results.push({ format: 'office-journey', status: 'failed', error: err.message });
    }

    // Video 2: Conference Room (10 scenes × ~8s = ~80s)
    try {
      var result2 = await this.produceVideoWithQA(
        this.writeConferenceRoomScript, 'conference-room', 'marketing', 80
      );
      results.push(result2);
    } catch (err) {
      this._log('error', 'Conference Room failed: ' + err.message);
      results.push({ format: 'conference-room', status: 'failed', error: err.message });
    }

    // Summary
    var completed = results.filter(function(r) { return r.status === 'awaiting_approval'; });
    var qaBlocked = results.filter(function(r) { return r.status === 'qa_failed'; });

    var summary = completed.length + '/' + results.length + ' scripts passed QA and await your approval. ' +
      qaBlocked.length + ' blocked by QA. ' +
      'Approve at residualvault.com/rv-control/ to start Veo generation.';

    await this.saveReport('video-production',
      'Weekly Video Production (QA v3.0) - ' + summary,
      JSON.stringify(results, null, 2)
    );

    return {
      weekOf: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      awaitingApproval: completed.length,
      qaBlocked: qaBlocked.length,
      results: results
    };
  }
}

module.exports = VeoVideoAgent;

if (require.main === module) {
  var agent = new VeoVideoAgent();
  agent.run().then(function(r) { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(function(e) { console.error(e); process.exit(1); });
}
