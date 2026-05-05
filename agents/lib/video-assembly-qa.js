'use strict';

var execFileSync = require('child_process').execFileSync;
var fs = require('fs');
var schema = require('./video-brief-schema');
var VideoQAError = schema.VideoQAError;

function runAssemblyQA(finalVideoPath, brief) {
  var errors = [];
  var metrics = {};

  // CHECK 1: File exists
  if (!fs.existsSync(finalVideoPath)) {
    throw new VideoQAError(
      'Final rendered video not found: ' + finalVideoPath,
      ['Remotion render did not produce an output file at the expected path'],
      'assembly-qa-file'
    );
  }

  var fileStats = fs.statSync(finalVideoPath);
  metrics.fileSizeBytes = fileStats.size;
  if (fileStats.size < 500000) {
    errors.push('Final video is only ' + fileStats.size + ' bytes — likely a failed render');
  }

  // CHECK 2: ffprobe the final video
  var probeData;
  try {
    var probeOutput = execFileSync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      finalVideoPath
    ], { encoding: 'utf8' });
    probeData = JSON.parse(probeOutput);
  } catch (err) {
    throw new VideoQAError(
      'Final video is corrupt — ffprobe cannot read it',
      ['ffprobe error: ' + err.message],
      'assembly-qa-ffprobe'
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

  // CHECK 3: Both streams present
  if (!videoStream) errors.push('Final video has no video stream');
  if (!audioStream) errors.push('Final video has no audio stream — voiceover missing from composition');

  // CHECK 4: Total duration within tolerance
  var actualDuration = parseFloat(format.duration || 0);
  metrics.actualDurationSeconds = actualDuration;
  metrics.targetDurationSeconds = brief.duration.targetSeconds;

  if (actualDuration < 5) {
    errors.push('Final video duration is ' + actualDuration.toFixed(1) + 's — too short to be valid');
  } else {
    var diff = Math.abs(actualDuration - brief.duration.targetSeconds);
    var tolerance = brief.duration.targetSeconds * 0.30;
    if (diff > tolerance) {
      errors.push(
        'Final video duration ' + actualDuration.toFixed(1) + 's differs from target ' +
        brief.duration.targetSeconds + 's by ' + diff.toFixed(1) + 's (>' + tolerance.toFixed(1) + 's tolerance). ' +
        'Scene stitching may have dropped or duplicated content.'
      );
    }
  }

  // CHECK 5: Audio completeness vs video
  if (audioStream && videoStream) {
    var audioDuration = parseFloat(audioStream.duration || actualDuration);
    metrics.audioDurationSeconds = audioDuration;
    var audioShort = actualDuration - audioDuration;
    if (audioShort > 2) {
      errors.push(
        'Audio ends ' + audioShort.toFixed(1) + 's before video ends. ' +
        'Voiceover cuts off in the final composition — Remotion audio mixing issue.'
      );
    }
  }

  // CHECK 6: Resolution matches expected output (at least 720p for YouTube)
  if (videoStream) {
    var width = parseInt(videoStream.width || 0, 10);
    var height = parseInt(videoStream.height || 0, 10);
    metrics.width = width;
    metrics.height = height;
    if (width < 1280 || height < 720) {
      errors.push(
        'Final video resolution ' + width + 'x' + height +
        ' is below 720p (1280x720). Not suitable for YouTube or professional publishing.'
      );
    }
  }

  // CHECK 7: Bitrate sanity (catches near-empty or bloated renders)
  if (format.bit_rate) {
    var bitrate = parseInt(format.bit_rate, 10);
    metrics.bitrateKbps = Math.round(bitrate / 1000);
    if (bitrate < 500000) {
      errors.push(
        'Final video bitrate is ' + Math.round(bitrate / 1000) + ' kbps — too low for quality publishing. ' +
        'Video may appear blocky or heavily compressed.'
      );
    }
  }

  // CHECK 8: Codec compatibility (h264 is universally supported)
  if (videoStream && videoStream.codec_name) {
    metrics.videoCodec = videoStream.codec_name;
    var safeCodecs = ['h264', 'hevc', 'h265', 'vp9', 'av1'];
    if (safeCodecs.indexOf(videoStream.codec_name) === -1) {
      errors.push(
        'Final video codec "' + videoStream.codec_name +
        '" may not be supported by all platforms. Prefer h264 for maximum compatibility.'
      );
    }
  }

  if (errors.length > 0) {
    throw new VideoQAError(
      'Final assembly QA failed with ' + errors.length + ' issue(s). Video NOT queued for review.',
      errors,
      'assembly-qa'
    );
  }

  return { passed: true, metrics: metrics };
}

module.exports = { runAssemblyQA: runAssemblyQA };
