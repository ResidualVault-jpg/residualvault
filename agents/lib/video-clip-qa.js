'use strict';

var execFileSync = require('child_process').execFileSync;
var fs = require('fs');
var schema = require('./video-brief-schema');
var VideoQAError = schema.VideoQAError;

function runClipQA(clipFilePath, scene, brief) {
  var errors = [];
  var metrics = {};

  // CHECK 1: File exists and has content
  if (!fs.existsSync(clipFilePath)) {
    throw new VideoQAError(
      'Clip file not found: ' + clipFilePath,
      ['Scene ' + scene.sceneIndex + ': Gemini returned a path that does not exist on disk'],
      'clip-qa-file'
    );
  }
  var fileStats = fs.statSync(clipFilePath);
  if (fileStats.size < 10000) {
    throw new VideoQAError(
      'Clip file is too small (' + fileStats.size + ' bytes) — likely corrupt or empty',
      ['Scene ' + scene.sceneIndex + ': file size ' + fileStats.size + ' bytes is below minimum threshold'],
      'clip-qa-file'
    );
  }
  metrics.fileSizeBytes = fileStats.size;

  // CHECK 2: ffprobe metadata
  var probeData;
  try {
    var probeOutput = execFileSync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      clipFilePath
    ], { encoding: 'utf8' });
    probeData = JSON.parse(probeOutput);
  } catch (probeErr) {
    throw new VideoQAError(
      'ffprobe failed on clip — video is likely corrupt',
      ['Scene ' + scene.sceneIndex + ': ffprobe could not parse the video file. Error: ' + probeErr.message],
      'clip-qa-ffprobe'
    );
  }

  var format = probeData.format || {};
  var streams = probeData.streams || [];
  var videoStream = null;
  var audioStream = null;
  for (var i = 0; i < streams.length; i++) {
    if (streams[i].codec_type === 'video' && !videoStream) videoStream = streams[i];
    if (streams[i].codec_type === 'audio' && !audioStream) audioStream = streams[i];
  }

  // CHECK 3: Video stream exists
  if (!videoStream) {
    errors.push('Scene ' + scene.sceneIndex + ': no video stream found in clip');
  }

  // CHECK 4: Duration check — Veo 3.1 outputs ~5-10s clips per generation
  // Only reject clips that are clearly broken; actual duration matching is
  // handled by the assembly QA on the final combined video
  var actualDurationSeconds = parseFloat(format.duration || 0);
  metrics.actualDurationSeconds = actualDurationSeconds;
  metrics.targetDurationSeconds = scene.durationSeconds;

  if (actualDurationSeconds < 3) {
    errors.push('Scene ' + scene.sceneIndex + ': clip duration is ' + actualDurationSeconds + 's — too short to be valid');
  } else if (actualDurationSeconds > 30) {
    errors.push('Scene ' + scene.sceneIndex + ': clip duration is ' + actualDurationSeconds + 's — unexpectedly long, may be corrupt');
  }

  // CHECK 5: Audio presence for avatar scenes
  if (scene.avatarPresent) {
    if (!audioStream) {
      errors.push(
        'Scene ' + scene.sceneIndex + ': avatarPresent is true but clip has NO audio stream. ' +
        'Voice cutoff at source — audio never generated.'
      );
    } else {
      // CHECK 6: Audio duration vs video duration (catches early cutoffs)
      var audioDuration = parseFloat(audioStream.duration || 0);
      metrics.audioDurationSeconds = audioDuration;

      if (audioDuration < 1) {
        errors.push('Scene ' + scene.sceneIndex + ': audio stream exists but duration is ' + audioDuration + 's — effectively silent');
      } else {
        var audioDiff = Math.abs(audioDuration - actualDurationSeconds);
        var audioTolerance = actualDurationSeconds * 0.10;
        if (audioDiff > audioTolerance) {
          errors.push(
            'Scene ' + scene.sceneIndex + ': audio duration (' + audioDuration.toFixed(1) + 's) differs from ' +
            'video duration (' + actualDurationSeconds.toFixed(1) + 's) by ' + audioDiff.toFixed(1) + 's. ' +
            'Voice likely cuts off before video ends.'
          );
        }
      }
    }
  }

  // CHECK 7: Reasonable frame rate (catch broken encoding)
  if (videoStream) {
    var fpsRaw = videoStream.r_frame_rate || '0/1';
    var parts = fpsRaw.split('/');
    var num = Number(parts[0]);
    var den = Number(parts[1]) || 1;
    var fps = den > 0 ? num / den : 0;
    metrics.fps = fps;
    if (fps < 12 || fps > 120) {
      errors.push('Scene ' + scene.sceneIndex + ': unusual frame rate ' + fps.toFixed(1) + 'fps — clip may be corrupt');
    }
  }

  // CHECK 8: Resolution sanity (Veo should produce at least 720p)
  if (videoStream) {
    var width = parseInt(videoStream.width || 0, 10);
    var height = parseInt(videoStream.height || 0, 10);
    metrics.width = width;
    metrics.height = height;
    if (width < 640 || height < 360) {
      errors.push(
        'Scene ' + scene.sceneIndex + ': resolution ' + width + 'x' + height +
        ' is below minimum (640x360). Clip may be a thumbnail or error frame.'
      );
    }
  }

  if (errors.length > 0) {
    throw new VideoQAError(
      'Clip QA failed for scene ' + scene.sceneIndex + ' with ' + errors.length + ' issue(s)',
      errors,
      'clip-qa'
    );
  }

  return { passed: true, metrics: metrics };
}

function buildRetryPrompt(originalScene, qaErrors, attemptNumber) {
  var corrections = qaErrors.map(function(err) {
    if (err.indexOf('no audio stream') !== -1) {
      return 'CRITICAL: The previous generation had NO audio/voiceover. ' +
             'This scene REQUIRES clear spoken dialogue. Ensure voice is generated.';
    }
    if (err.indexOf('audio duration') !== -1 && err.indexOf('cuts off') !== -1) {
      return 'CRITICAL: The voiceover cut off before the video ended. ' +
             'Ensure the full dialogue is spoken to completion before the clip ends.';
    }
    if (err.indexOf('effectively silent') !== -1) {
      return 'CRITICAL: The audio track was effectively silent. Generate audible, clear speech.';
    }
    if (err.indexOf('duration') !== -1 && err.indexOf('differs') !== -1) {
      return 'Duration issue: previous clip was wrong length. ' +
             'Target is exactly ' + originalScene.durationSeconds + ' seconds.';
    }
    if (err.indexOf('corrupt') !== -1 || err.indexOf('ffprobe') !== -1) {
      return 'Previous clip was corrupt or unplayable. Generate a clean, valid video file.';
    }
    if (err.indexOf('frame rate') !== -1) {
      return 'Previous clip had an abnormal frame rate. Generate at standard 24fps or 30fps.';
    }
    if (err.indexOf('resolution') !== -1) {
      return 'Previous clip had too low resolution. Generate at least 720p quality.';
    }
    return 'Issue from previous attempt: ' + err;
  }).join('\n');

  return originalScene.geminiPrompt + '\n\n' +
    'CORRECTIONS REQUIRED (attempt ' + attemptNumber + '):\n' +
    corrections + '\n\n' +
    'CRITICAL REMINDERS FOR THIS SCENE:\n' +
    '- Exactly ONE presenter/avatar — no additional people in frame\n' +
    '- Presenter: ' + (originalScene.avatarPresent ? 'must be visible and speaking' : 'B-roll only, no avatar') + '\n' +
    '- Duration: exactly ' + originalScene.durationSeconds + ' seconds\n' +
    '- Complete all dialogue — do not cut off mid-sentence\n' +
    '- Visual style must match: ' + originalScene.visualKeywords.join(', ');
}

module.exports = { runClipQA: runClipQA, buildRetryPrompt: buildRetryPrompt };
