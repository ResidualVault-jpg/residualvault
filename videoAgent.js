require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pool = require('./db');

const PIPER_PATH = '/home/vaultadmin/piper-env/bin/piper';
const VOICE_MODEL = '/home/vaultadmin/residualvault/video/models/en_US-lessac-high.onnx';
const VIDEO_DIR = '/home/vaultadmin/residualvault/video';
const FONT_BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
const FONT_REG  = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';

async function generateScript(topic) {
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-6', max_tokens: 2048,
    messages: [{ role: 'user', content: `Write a 60-second YouTube Shorts script for Residual Vault about: "${topic}"

STRICT RULES FOR TEXT FIELDS:
- S#TEXT must be exactly 2 short words, ALL CAPS, letters only, no numbers no symbols
- S#VOICE must be 2 to 3 full sentences, at least 25 words total, natural spoken language
- Write voiceover as if a friendly financial educator is speaking directly to the viewer
- Every voiceover must end with a complete thought, never trail off

Format EXACTLY like this:
TITLE: [title under 40 chars no special chars]
S1TEXT: [2 WORDS]
S1VOICE: [2 short snappy sentences, 15-18 words max. Hook viewer: crypto staking earns passive income right now.]
S2TEXT: [2 WORDS]
S2VOICE: [2 short snappy sentences, 15-18 words max. Ethereum staking pays 4-6 percent APY consistently.]
S3TEXT: [2 WORDS]
S3VOICE: [2 short snappy sentences, 15-18 words max. Compounding staking rewards multiply earnings significantly over time.]
S4TEXT: [2 WORDS]
S4VOICE: [2 short snappy sentences, 15-18 words max. Residual Vault compares 150 plus protocols side by side free.]
S5TEXT: [FREE FOREVER]
S5VOICE: [2 short snappy sentences, 15-18 words max. Visit residual vault dot com now, compare staking free.]` }]
  }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });

  const text = response.data.content[0].text;
  const get = (key) => {
    const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim().replace(/['"()[\]:]/g, '').substring(0, 40) : '';
  };
  const getVoice = (key) => {
    const match = text.match(new RegExp(`^${key}:\\s*(.+?)(?=\\nS|\\nTITLE|$)`, 'ms'));
    return match ? match[1].trim().replace(/['"]/g, ' ').replace(/[^\w\s.,!?]/g, ' ').trim() : '';
  };

  return {
    title: get('TITLE'),
    scenes: [
      { text: get('S1TEXT'), voice: getVoice('S1VOICE'), bg: '0x0d0d1a', accent: '6c63ff', sub: 'EARN MORE'        },
      { text: get('S2TEXT'), voice: getVoice('S2VOICE'), bg: '0x0a1628', accent: '00d4ff', sub: 'ETHEREUM'          },
      { text: get('S3TEXT'), voice: getVoice('S3VOICE'), bg: '0x1a0a1a', accent: 'ff6b6b', sub: 'TOP YIELDS'        },
      { text: get('S4TEXT'), voice: getVoice('S4VOICE'), bg: '0x0f0a28', accent: 'ffd93d', sub: 'COMPARE NOW'       },
      { text: get('S5TEXT'), voice: getVoice('S5VOICE'), bg: '0x0d0d1a', accent: '6c63ff', sub: 'RESIDUALVAULT.COM' },
    ]
  };
}

function generateVoiceover(text, outputPath) {
  const safe = text.replace(/['"]/g, ' ').replace(/\+/g, 'plus').replace(/[^\w\s.,!?]/g, ' ').trim();
  execSync(`echo "${safe}" | ${PIPER_PATH} --model ${VOICE_MODEL} --output_file ${outputPath} 2>/dev/null`);
}

function getAudioDuration(audioPath) {
  try {
    return parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}" 2>/dev/null`).toString().trim()) || 3;
  } catch { return 3; }
}

function createSceneVideo(scene, duration, outputPath) {
  const rawText = (scene.text || '').replace(/[^a-zA-Z ]/g, '').toUpperCase().trim();
  const safeSub = (scene.sub  || '').replace(/[^a-zA-Z0-9. ]/g, '').toUpperCase().trim();
  const accent  = scene.accent || '6c63ff';
  const bg      = scene.bg || '0x0d0d1a';

  const words = rawText.split(' ');
  const line1 = words[0] || '';
  const line2 = words[1] || '';
  const line1Y = line2 ? '820' : '900';
  const line2Y = '960';

  const filters = [
    `drawbox=x=0:y=0:w=1080:h=1920:color=${bg}@1:t=fill`,
    `drawbox=x=240:y=760:w=600:h=400:color=0x${accent}@0.06:t=fill`,
    `drawbox=x=0:y=0:w=1080:h=120:color=black@0.75:t=fill`,
    `drawbox=x=0:y=120:w=1080:h=5:color=0x${accent}@1:t=fill`,
    `drawtext=fontfile='${FONT_BOLD}':text='RESIDUAL VAULT':fontsize=48:fontcolor=0x${accent}:x=(w-text_w)/2:y=30`,
    `drawtext=fontfile='${FONT_REG}':text='residualvault.com':fontsize=28:fontcolor=white@0.6:x=(w-text_w)/2:y=82`,
    `drawbox=x=55:y=680:w=7:h=560:color=0x${accent}@1:t=fill`,
    `drawbox=x=62:y=680:w=958:h=560:color=black@0.35:t=fill`,
    `drawtext=fontfile='${FONT_BOLD}':text='${line1}':fontsize=130:fontcolor=white:x=(w-text_w)/2:y=${line1Y}`,
    ...(line2 ? [`drawtext=fontfile='${FONT_BOLD}':text='${line2}':fontsize=130:fontcolor=white:x=(w-text_w)/2:y=${line2Y}`] : []),
    `drawtext=fontfile='${FONT_BOLD}':text='${safeSub}':fontsize=38:fontcolor=0x${accent}:x=(w-text_w)/2:y=1110`,
    `drawbox=x=0:y=1795:w=1080:h=5:color=0x${accent}@1:t=fill`,
    `drawbox=x=0:y=1800:w=1080:h=120:color=black@0.75:t=fill`,
    `drawtext=fontfile='${FONT_REG}':text='Compare 150+ Staking Protocols Free':fontsize=30:fontcolor=white@0.7:x=(w-text_w)/2:y=1845`
  ].join(',');

  execSync(`ffmpeg -y \
    -f lavfi -i "color=c=${bg}:size=1080x1920:rate=30" \
    -vf "${filters}" \
    -t ${duration} \
    -c:v libx264 -pix_fmt yuv420p \
    "${outputPath}" 2>/dev/null`, { stdio: 'pipe' });
}

async function generateVideo(topic = 'Top 5 Crypto Staking Rewards in 2026') {
  const id = `rv_${Date.now()}`;
  const scenesDir = path.join(VIDEO_DIR, 'scenes', id);
  const audioDir  = path.join(VIDEO_DIR, 'audio');
  const outputDir = path.join(VIDEO_DIR, 'output');
  [scenesDir, audioDir, outputDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

  console.log(`[VideoAgent] 🚀 Starting video pipeline for: ${topic}`);
  console.log('[VideoAgent] 📝 Generating script...');
  const script = await generateScript(topic);
  console.log(`[VideoAgent] ✅ Script: "${script.title}"`);

  const sceneFiles = [];

  for (let i = 0; i < script.scenes.length; i++) {
    const scene     = script.scenes[i];
    const audioPath = path.join(audioDir,  `${id}_s${i}.wav`);
    const bgPath    = path.join(scenesDir, `s${i}_bg.mp4`);
    const scenePath = path.join(scenesDir, `s${i}.mp4`);

    console.log(`[VideoAgent] 🎙️ Scene ${i+1}/5: "${scene.text}"`);

    generateVoiceover(scene.voice, audioPath);
    const audioDur = getAudioDuration(audioPath);
    const duration = audioDur + 0.5;
    console.log(`[VideoAgent] 🔊 Audio: ${audioDur.toFixed(1)}s → Video: ${duration.toFixed(1)}s`);

    createSceneVideo(scene, duration, bgPath);

    execSync(`ffmpeg -y \
      -i "${bgPath}" \
      -i "${audioPath}" \
      -c:v copy -c:a aac \
      -map 0:v:0 -map 1:a:0 \
      "${scenePath}" 2>/dev/null`);

    try { fs.unlinkSync(bgPath); } catch {}
    sceneFiles.push(scenePath);
    console.log(`[VideoAgent] ✅ Scene ${i+1} done (${duration.toFixed(1)}s)`);
  }

  console.log('[VideoAgent] 🎬 Assembling final video...');
  const concatFile = path.join(scenesDir, 'list.txt');
  fs.writeFileSync(concatFile, sceneFiles.map(f => `file '${f}'`).join('\n'));

  const outputPath = path.join(outputDir, `${id}.mp4`);
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" \
    -c:v libx264 -c:a aac -pix_fmt yuv420p \
    "${outputPath}" 2>/dev/null`);

  try {
    await pool.query(`INSERT INTO video_queue (video_id, title, file_path, status) VALUES ($1,$2,$3,'pending') ON CONFLICT DO NOTHING`, [id, script.title, outputPath]);
  } catch(e) {}

  console.log(`[VideoAgent] ✅ Video: ${outputPath}`);
  console.log(`[VideoAgent] 🎉 Complete! ID: ${id}`);
  return { id, title: script.title, outputPath };
}

module.exports = { generateVideo };

async function uploadToYouTube(videoPath, title) {
  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      'https://residualvault.com/auth/google/callback'
    );
    oauth2Client.setCredentials({
      access_token: process.env.YOUTUBE_ACCESS_TOKEN,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title,
          description: `Compare 150+ crypto staking protocols for free at residualvault.com\n\n#CryptoStaking #StakingAPY #DeFi #PassiveIncome #Web3 #CryptoYield`,
          tags: ['crypto staking', 'staking APY', 'DeFi', 'passive income', 'ethereum staking', 'crypto yield'],
          categoryId: '27'
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: require('fs').createReadStream(videoPath)
      }
    });

    console.log(`[YouTube] ✅ Uploaded: ${response.data.id} — ${title}`);
    return { success: true, videoId: response.data.id };
  } catch (err) {
    console.error(`[YouTube] ❌ Upload failed:`, err?.response?.data || err.message);
    return { success: false, error: JSON.stringify(err?.response?.data || err.message) };
  }
}

module.exports = { generateVideo, uploadToYouTube };
