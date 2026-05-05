'use strict';

class VideoQAError extends Error {
  constructor(message, errors, component) {
    super(message);
    this.name = 'VideoQAError';
    this.errors = errors || [];
    this.component = component || 'brief-schema';
    this.timestamp = new Date().toISOString();
  }
}

function validateVideoBrief(brief) {
  var errors = [];

  if (!brief.jobId) errors.push('jobId is required');
  if (brief.brand !== 'ResidualVault') errors.push('brand must be "ResidualVault"');
  if (!brief.title || brief.title.length > 80) errors.push('title required, max 80 chars');
  var validPurposes = ['marketing', 'explainer', 'promo', 'announcement'];
  if (validPurposes.indexOf(brief.purpose) === -1) {
    errors.push('purpose must be one of: ' + validPurposes.join(', '));
  }

  if (!brief.avatar) {
    errors.push('CRITICAL: avatar block is required');
  } else {
    if (brief.avatar.count !== 1) {
      errors.push(
        'CRITICAL: avatar.count must be exactly 1. Got: ' + brief.avatar.count +
        '. Multiple avatars are the #1 cause of failed video runs. This run is blocked.'
      );
    }
    if (!brief.avatar.description) errors.push('avatar.description is required');
    if (!brief.avatar.consistencyInstruction) {
      errors.push('avatar.consistencyInstruction is required — used in every Gemini scene prompt');
    }
  }

  if (!brief.duration || !brief.duration.targetSeconds) {
    errors.push('duration.targetSeconds is required');
  } else {
    if (brief.duration.targetSeconds < 15) {
      errors.push('duration.targetSeconds must be at least 15');
    }
    if (brief.duration.targetSeconds > 180) {
      errors.push('duration.targetSeconds must be 180 or less (3 min max)');
    }
  }

  if (!brief.audio) {
    errors.push('audio block is required');
  } else {
    if (!brief.audio.scriptWordCount || brief.audio.scriptWordCount < 1) {
      errors.push('audio.scriptWordCount must be populated from the actual script');
    }
    if (!brief.audio.estimatedAudioSeconds) {
      errors.push('audio.estimatedAudioSeconds is required (scriptWordCount / 2.5)');
    } else if (brief.duration && brief.duration.targetSeconds) {
      var audioDiff = Math.abs(brief.audio.estimatedAudioSeconds - brief.duration.targetSeconds);
      var tolerance = brief.duration.targetSeconds * 0.30;
      if (audioDiff > tolerance) {
        errors.push(
          'audio.estimatedAudioSeconds (' + brief.audio.estimatedAudioSeconds +
          's) is more than 30% off from duration.targetSeconds (' +
          brief.duration.targetSeconds + 's). Fix the script first.'
        );
      }
    }
  }

  if (!Array.isArray(brief.scenes) || brief.scenes.length < 1) {
    errors.push('scenes must be a non-empty array');
  } else {
    if (brief.scenes.length > 12) {
      errors.push('scenes must have 12 or fewer entries — more scenes = more stitching failures');
    }

    var totalSceneDuration = brief.scenes.reduce(function(sum, s) { return sum + (s.durationSeconds || 0); }, 0);
    if (brief.duration && brief.duration.targetSeconds) {
      var sceneDiff = Math.abs(totalSceneDuration - brief.duration.targetSeconds);
      var sceneTolerance = brief.duration.targetSeconds * 0.10;
      if (sceneDiff > sceneTolerance) {
        errors.push(
          'Sum of scene durations (' + totalSceneDuration +
          's) differs from targetSeconds (' + brief.duration.targetSeconds +
          's) by more than 10%. Adjust scene durations.'
        );
      }
    }

    brief.scenes.forEach(function(scene, i) {
      var s = 'Scene[' + i + ']';
      if (scene.sceneIndex !== i) errors.push(s + ': sceneIndex must equal ' + i);
      if (!scene.description) errors.push(s + ': description is required');
      if (!scene.durationSeconds || scene.durationSeconds < 2) {
        errors.push(s + ': durationSeconds must be >= 2');
      }
      if (typeof scene.avatarPresent !== 'boolean') {
        errors.push(s + ': avatarPresent must be true or false');
      }
      if (!Array.isArray(scene.visualKeywords) || scene.visualKeywords.length < 3) {
        errors.push(s + ': visualKeywords must have at least 3 entries');
      }
      if (!scene.geminiPrompt || scene.geminiPrompt.length < 20) {
        errors.push(s + ': geminiPrompt must be written and at least 20 chars');
      }
      if (scene.avatarPresent && (!scene.dialogue || scene.dialogue.trim().length === 0)) {
        errors.push(s + ': avatarPresent is true but dialogue is empty — avatar scenes must have dialogue');
      }
      var validTransitions = ['crossfade', 'cut', 'fade-from-black'];
      if (validTransitions.indexOf(scene.transitionIn) === -1) {
        errors.push(s + ': transitionIn must be one of: ' + validTransitions.join(', '));
      }
    });
  }

  if (!brief.constraints) {
    errors.push('constraints block is required');
  } else {
    if (brief.constraints.maxRetriesPerScene > 3) {
      errors.push('constraints.maxRetriesPerScene cannot exceed 3');
    }
    if (brief.constraints.maxTotalRetries > 5) {
      errors.push('constraints.maxTotalRetries cannot exceed 5');
    }
    if (brief.constraints.qaGateRequired !== true) {
      errors.push('constraints.qaGateRequired must be true — this cannot be disabled');
    }
    if (brief.constraints.humanReviewRequired !== true) {
      errors.push('constraints.humanReviewRequired must be true — this cannot be disabled');
    }
  }

  if (errors.length > 0) {
    throw new VideoQAError(
      'Video brief failed validation with ' + errors.length + ' error(s). No Gemini calls made.',
      errors,
      'brief-schema'
    );
  }

  return { valid: true };
}

module.exports = { validateVideoBrief: validateVideoBrief, VideoQAError: VideoQAError };
