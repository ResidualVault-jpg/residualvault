require('dotenv').config();
const axios = require('axios');
const pool = require('./db');

// ─── LINKEDIN PUBLISHER ───────────────────────────────────────────
async function publishToLinkedIn(post) {
  try {
    // Get member ID using OpenID userinfo endpoint
    const profileRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
        'LinkedIn-Version': '202401'
      }
    });
    const memberId = profileRes.data.sub;
    console.log(`[LinkedIn] Member ID: ${memberId}`);

    // Post content using UGC API
    const postContent = post.platform === 'twitter'
      ? post.content.split('---')[0].trim()
      : post.content;

    const response = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      {
        author: `urn:li:person:${memberId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: `${postContent}\n\n${post.hashtags || ''}`
            },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202401'
        }
      }
    );
    console.log(`[LinkedIn] ✅ Posted successfully: ${response.data.id}`);
    return { success: true, postId: response.data.id };
  } catch (err) {
    console.error(`[LinkedIn] ❌ Failed:`, err.response?.data || err.message);
    return { success: false, error: JSON.stringify(err.response?.data || err.message) };
  }
}

// ─── TWITTER/X PUBLISHER ─────────────────────────────────────────
async function publishToTwitter(post) {
  try {
    const { TwitterApi } = require('twitter-api-v2');
    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    let tweetText = post.content.includes('---')
      ? post.content.split('---')[0].trim()
      : post.content;

    if (tweetText.length > 270) tweetText = tweetText.substring(0, 267) + '...';

    const response = await client.v2.tweet(tweetText);
    console.log(`[Twitter] ✅ Posted: ${response.data.id}`);
    return { success: true, postId: response.data.id };
  } catch (err) {
    console.error(`[Twitter] ❌ Failed:`, err?.data || err.message);
    return { success: false, error: JSON.stringify(err?.data || err.message) };
  }
}

// ─── MAIN PUBLISHER ──────────────────────────────────────────────
async function publishApprovedPosts() {
  console.log('[Publisher] 🚀 Checking for approved posts to publish...');
  try {
    const result = await pool.query(`
      SELECT * FROM content_posts
      WHERE status = 'approved'
      AND scheduled_date <= CURRENT_DATE
      ORDER BY scheduled_date ASC, platform ASC
    `);

    if (result.rows.length === 0) {
      console.log('[Publisher] No approved posts ready to publish.');
      return;
    }

    console.log(`[Publisher] Found ${result.rows.length} posts to publish`);

    for (const post of result.rows) {
      console.log(`[Publisher] Publishing ${post.platform} post (id: ${post.id})...`);
      let publishResult = { success: false, error: 'Platform not configured' };

      if (post.platform === 'linkedin') {
        publishResult = await publishToLinkedIn(post);
      } else if (post.platform === 'twitter') {
        publishResult = await publishToTwitter(post);
      } else {
        console.log(`[Publisher] ⏭️ Skipping ${post.platform} - not yet configured`);
        continue;
      }

      if (publishResult.success) {
        await pool.query(
          `UPDATE content_posts SET status = 'published', updated_at = NOW() WHERE id = $1`,
          [post.id]
        );
        console.log(`[Publisher] ✅ Post ${post.id} marked as published`);
      } else {
        await pool.query(
          `UPDATE content_posts SET status = 'failed', rejection_reason = $2, updated_at = NOW() WHERE id = $1`,
          [post.id, publishResult.error]
        );
        console.log(`[Publisher] ❌ Post ${post.id} marked as failed`);
      }

      await new Promise(r => setTimeout(r, 3000));
    }

    console.log('[Publisher] ✅ Publishing cycle complete!');
  } catch (err) {
    console.error('[Publisher] ❌ Error:', err.message);
  }
}

module.exports = { publishApprovedPosts };
