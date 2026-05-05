'use strict';

var Anthropic = require('@anthropic-ai/sdk');
var schema = require('./video-brief-schema');
var VideoQAError = schema.VideoQAError;

async function runScriptQA(brief, anthropicApiKey) {
  var client = new Anthropic({ apiKey: anthropicApiKey });

  var scenesSummary = brief.scenes.map(function(s, i) {
    return 'Scene ' + i + ' (' + s.durationSeconds + 's, avatar: ' + s.avatarPresent + '):\n' +
      '  Dialogue: "' + (s.dialogue || '[B-roll — no dialogue]') + '"\n' +
      '  Visuals: ' + s.visualKeywords.join(', ') + '\n' +
      '  Transition in: ' + s.transitionIn + '\n' +
      '  Gemini prompt: "' + s.geminiPrompt + '"';
  }).join('\n\n');

  var evaluationPrompt =
    'You are a video production QA specialist reviewing a script and scene plan for\n' +
    'ResidualVault — a professional cryptocurrency staking comparison platform based in\n' +
    'Albuquerque, NM. The audience is crypto investors and DeFi participants.\n\n' +
    'Brand voice: professional, trustworthy, data-driven, clear, authoritative.\n\n' +
    'You are reviewing the following video brief before any video is generated.\n' +
    'Your job is to find problems NOW — before expensive video generation happens.\n\n' +
    'VIDEO BRIEF:\n' +
    'Title: ' + brief.title + '\n' +
    'Purpose: ' + brief.purpose + '\n' +
    'Target duration: ' + brief.duration.targetSeconds + ' seconds\n' +
    'Avatar: Exactly 1 presenter. Description: ' + brief.avatar.description + '\n' +
    'Total script word count: ' + brief.audio.scriptWordCount + '\n' +
    'Estimated audio duration: ' + brief.audio.estimatedAudioSeconds + ' seconds\n' +
    'Target platforms: ' + (brief.meta && brief.meta.targetPlatforms ? brief.meta.targetPlatforms.join(', ') : 'not specified') + '\n\n' +
    'SCENE PLAN:\n' + scenesSummary + '\n\n' +
    'EVALUATE each of the following. For each issue found, provide the scene index,\n' +
    'the specific problem, and the recommended fix.\n\n' +
    'CHECKS TO RUN:\n' +
    '1. AVATAR COUNT: Does the script or any scene reference more than one human\n' +
    '   presenter, avatar, or person speaking to camera? Even indirect references\n' +
    '   like "our team" appearing on screen counts. Flag any instance.\n\n' +
    '2. DIALOGUE COMPLETENESS: Does any scene\'s dialogue appear to cut off\n' +
    '   mid-sentence, end abruptly, or feel incomplete? A scene\'s dialogue should\n' +
    '   feel like a complete thought.\n\n' +
    '3. AUDIO VS DURATION: Is the estimated audio duration (' + brief.audio.estimatedAudioSeconds + 's)\n' +
    '   reasonable for the target video duration (' + brief.duration.targetSeconds + 's)?\n' +
    '   The allowed tolerance is 30% (i.e. ' + Math.round(brief.duration.targetSeconds * 0.7) + 's to ' + Math.round(brief.duration.targetSeconds * 1.3) + 's).\n' +
    '   Only flag as CRITICAL if the estimated audio is OUTSIDE that range.\n' +
    '   If the audio is within the 30% tolerance, flag as warning at most.\n\n' +
    '4. VISUAL-DIALOGUE COHERENCE: For each scene where avatarPresent is true,\n' +
    '   do the visualKeywords match what the dialogue is talking about? A presenter\n' +
    '   talking about APY yields while visual keywords say "mountain landscape" is a mismatch.\n\n' +
    '5. TRANSITION COHERENCE: Looking at adjacent scenes in sequence, would the\n' +
    '   transitions feel natural? Flag any jarring jumps between scenes.\n\n' +
    '6. GEMINI PROMPT QUALITY: For each scene\'s geminiPrompt, would this prompt\n' +
    '   produce a clip that matches the scene description and dialogue? A vague\n' +
    '   or contradictory Gemini prompt will produce a bad clip.\n' +
    '   NOTE: The geminiPrompt includes the FULL dialogue text for lip-sync.\n' +
    '   Verify the dialogue in the geminiPrompt matches the scene dialogue field completely.\n\n' +
    '7. BRAND COMPLIANCE: Does the script stay on-brand for ResidualVault?\n' +
    '   Flag anything that sounds unprofessional or inconsistent with the platform\'s voice.\n' +
    '   IMPORTANT: The following are VERIFIED and APPROVED by the business owner — do NOT flag these:\n' +
    '   - Platform statistics: "150+ protocols", "tracks protocols across blockchains", etc.\n' +
    '   - General yield language: "top-performing yields", "industry-leading returns", "highest returns in DeFi"\n' +
    '   - Feature descriptions: "real-time tracking", "automated alerts", "free and PRO plans"\n' +
    '   Only flag as CRITICAL: guaranteed future returns, false claims about specific APY numbers,\n' +
    '   promises of profit, or language that violates securities law (e.g., "you WILL earn X").\n' +
    '   Marketing language like "some of the best" or "industry-leading" is standard and acceptable.\n\n' +
    'RESPOND IN THIS EXACT JSON FORMAT — no other text:\n' +
    '{\n' +
    '  "passed": true | false,\n' +
    '  "issues": [\n' +
    '    {\n' +
    '      "sceneIndex": number | null,\n' +
    '      "checkName": string,\n' +
    '      "severity": "critical" | "warning",\n' +
    '      "problem": string,\n' +
    '      "recommendedFix": string\n' +
    '    }\n' +
    '  ],\n' +
    '  "overallAssessment": string\n' +
    '}\n\n' +
    'If passed is true, issues array must be empty or contain only warnings (no criticals).\n' +
    'If any critical issue exists, passed must be false.';

  var response;
  var rawText = '';
  try {
    var message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: evaluationPrompt }]
    });
    rawText = message.content[0].text;

    // Try fenced code block first: ```json ... ```
    var fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      response = JSON.parse(fenced[1].trim());
    } else {
      // Try bare JSON object
      var jsonMatch = rawText.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        response = JSON.parse(jsonMatch[1]);
      } else {
        response = JSON.parse(rawText.trim());
      }
    }
  } catch (parseErr) {
    if (parseErr instanceof VideoQAError) throw parseErr;
    throw new VideoQAError(
      'Script QA failed — Claude response could not be parsed: ' + parseErr.message,
      ['Raw response (first 500 chars): ' + rawText.substring(0, 500)],
      'script-qa'
    );
  }

  if (!response.passed) {
    var criticalIssues = (response.issues || [])
      .filter(function(i) { return i.severity === 'critical'; })
      .map(function(i) {
        return '[Scene ' + (i.sceneIndex !== null && i.sceneIndex !== undefined ? i.sceneIndex : 'overall') + '] ' +
          i.checkName + ': ' + i.problem + ' → Fix: ' + i.recommendedFix;
      });

    if (criticalIssues.length > 0) {
      throw new VideoQAError(
        'Script QA failed with ' + criticalIssues.length + ' critical issue(s). No clips generated.',
        criticalIssues,
        'script-qa'
      );
    }
  }

  return {
    passed: true,
    warnings: (response.issues || []).filter(function(i) { return i.severity === 'warning'; }),
    assessment: response.overallAssessment
  };
}

module.exports = { runScriptQA: runScriptQA };
