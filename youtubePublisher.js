require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  'http://localhost'
);

oauth2Client.setCredentials({
  access_token: process.env.YOUTUBE_ACCESS_TOKEN,
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
});

// Auto-refresh token when expired
oauth2Client.on('tokens', async (tokens) => {
  if (tokens.access_token) {
    console.log('[YouTube] 🔄 Access token refreshed automatically');
    // Update .env with new token
    const envPath = '/home/vaultadmin/residualvault/.env';
    let env = fs.readFileSync(envPath, 'utf8');
    env = env.replace(/YOUTUBE_ACCESS_TOKEN=.*/,
      `YOUTUBE_ACCESS_TOKEN=${tokens.access_token}`);
    fs.writeFileSync(envPath, env);
  }
});

const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

async function uploadVideoToYouTube(videoId, filePath, title, description, hashtags) {
  try {
    console.log(`[YouTube] 📤 Uploading: "${title}"`);

    const tags = hashtags
      ? hashtags.replace(/#/g, '').split(' ').filter(Boolean)
      : ['CryptoStaking', 'StakingAPY', 'DeFi', 'PassiveIncome', 'Shorts'];

    const fullDescription = `${description || title}

Compare 150+ crypto staking protocols at residualvault.com — completely free, live APY rates updated every 15 minutes.

${hashtags || '#CryptoStaking #StakingAPY #DeFi #PassiveIncome #Shorts #YouTube'}`;

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title.substring(0, 100),
          description: fullDescription,
          tags: tags.slice(0, 15),
          categoryId: '27', // Education
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en'
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
          madeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(filePath)
      }
    });

    const youtubeVideoId = response.data.id;
    const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    console.log(`[YouTube] ✅ Uploaded! URL: ${youtubeUrl}`);
    return { success: true, youtubeVideoId, youtubeUrl };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error(`[YouTube] ❌ Failed: ${msg}`);
    return { success: false, error: msg };
  }
}

async function publishApprovedVideos() {
  console.log('[YouTube] 🚀 Checking for approved videos to upload...');

  try {
    // Get approved videos from queue
    const result = await pool.query(`
      SELECT * FROM video_queue
      WHERE status = 'approved'
      ORDER BY created_at ASC
    `);

    if (result.rows.length === 0) {
      console.log('[YouTube] No approved videos ready to upload.');
      return;
    }

    console.log(`[YouTube] Found ${result.rows.length} videos to upload`);

    for (const video of result.rows) {
      if (!fs.existsSync(video.video_path)) {
        console.log(`[YouTube] ⚠️ File not found: ${video.video_path}`);
        await pool.query(`UPDATE video_queue SET status='failed' WHERE video_id=$1`, [video.video_id]);
        continue;
      }

      const result2 = await uploadVideoToYouTube(
        video.video_id,
        video.video_path,
        video.title,
        video.description || video.title,
        video.hashtags
      );

      if (result2.success) {
        await pool.query(`
          UPDATE video_queue
          SET status='published',
              youtube_url=$2,
              published_at=NOW()
          WHERE video_id=$1`,
          [video.video_id, result2.youtubeUrl]
        );
        console.log(`[YouTube] ✅ Video ${video.video_id} published!`);
      } else {
        await pool.query(`
          UPDATE video_queue
          SET status='failed', error_message=$2
          WHERE video_id=$1`,
          [video.video_id, result2.error]
        );
      }

      // Wait 5 seconds between uploads
      await new Promise(r => setTimeout(r, 5000));
    }

    console.log('[YouTube] ✅ Upload cycle complete!');
  } catch (err) {
    console.error('[YouTube] ❌ Error:', err.message);
  }
}

module.exports = { publishApprovedVideos, uploadVideoToYouTube };
