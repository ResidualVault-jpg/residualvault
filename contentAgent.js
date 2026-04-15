require('dotenv').config();
const axios = require('axios');
const pool = require('./db');

const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── OPTIMAL POSTING TIMES (UTC) BY PLATFORM ─────────────────────
// Based on global peak engagement research
const POSTING_SCHEDULE = {
  linkedin:  ['09:00', '12:00', '17:00'], // 9am, noon, 5pm UTC (business hours globally)
  twitter:   ['08:00', '13:00', '20:00'], // 8am, 1pm, 8pm UTC (catches US, EU, Asia)
  facebook:  ['09:00', '15:00', '20:00'], // 9am, 3pm, 8pm UTC
  instagram: ['08:00', '12:00', '19:00'], // 8am, noon, 7pm UTC
  reddit:    ['10:00', '14:00', '21:00'], // 10am, 2pm, 9pm UTC (Reddit peaks)
  youtube:   ['09:00', '15:00', '20:00'], // 9am, 3pm, 8pm UTC
};

const SEO_HASHTAGS = {
  linkedin:  '#CryptoStaking #StakingAPY #DeFi #PassiveIncome #Ethereum #ATOM #CryptoYield #Web3 #BlockchainFinance #StakingRewards',
  twitter:   '#CryptoStaking #StakingAPY #DeFi #PassiveIncome #ATOM #ETH',
  facebook:  '#CryptoStaking #DeFi #PassiveIncome #StakingRewards #Crypto',
  instagram: '#CryptoStaking #StakingAPY #DeFi #PassiveIncome #Ethereum #ATOM #CryptoYield #Web3 #BlockchainFinance #StakingRewards #CryptoPassiveIncome #LiquidStaking #ProofOfStake #CryptoInvesting #DeFiYields',
  reddit:    'CryptoCurrency',
  youtube:   '#CryptoStaking #StakingAPY #DeFi #PassiveIncome #Ethereum #ATOM #CryptoYield #Web3 #Shorts',
};

// ─── POST TYPE ROTATION ───────────────────────────────────────────
// Each platform gets 3 different post types per day
const POST_TYPES = {
  linkedin: [
    'educational - share a staking insight or data point',
    'founder story - personal perspective on DeFi and passive income',
    'industry news - comment on a crypto staking trend or protocol update'
  ],
  twitter: [
    'data thread - share APY stats and protocol comparisons',
    'educational thread - teach something about staking',
    'engagement tweet - ask a question or run a poll about staking'
  ],
  facebook: [
    'educational post - explain a staking concept',
    'community question - ask followers about their staking experience',
    'platform feature highlight - show what residualvault.com can do'
  ],
  instagram: [
    '30-second Reels video script - hook + value + CTA',
    '30-second Reels video script - tutorial style showing staking comparison',
    '30-second Reels video script - trending crypto topic with staking angle'
  ],
  reddit: [
    'value post - share data or insight, ask for community feedback',
    'discussion starter - ask a genuine question about staking strategies',
    'tool showcase - authentically share residualvault.com as a resource'
  ],
  youtube: [
    '60-second Shorts script - top staking protocols this week',
    '60-second Shorts script - beginner guide to staking one protocol',
    '60-second Shorts script - comparison of two competing staking options'
  ]
};

async function getActiveKeywords() {
  try {
    const result = await pool.query('SELECT keyword FROM keywords WHERE active = true ORDER BY priority DESC');
    return result.rows.map(r => r.keyword);
  } catch (err) {
    console.error('[ContentAgent] Failed to load keywords:', err.message);
    return ['crypto staking', 'staking APY', 'best staking rewards 2026', 'DeFi yields', 'passive crypto income'];
  }
}

function getWeeklyKeywords(allKeywords) {
  const shuffled = [...allKeywords].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 5); // Use 5 keywords rotated across 3 posts
}

function buildPrompt(platformName, postType, keywords, postIndex) {
  const keywordSubset = keywords.slice(postIndex % 3, (postIndex % 3) + 2);

  const baseInstructions = `You are a content writer for Residual Vault (residualvault.com), a crypto staking comparison platform that lets users compare staking APY across 150+ protocols for free.
Keywords to include naturally: ${keywordSubset.join(', ')}
Post type: ${postType}`;

  switch(platformName) {
    case 'linkedin':
      return `${baseInstructions}

Write a LinkedIn post (150-200 words) that matches the post type above.
- Professional, educational tone
- End with a question to drive engagement
- Include a CTA to visit residualvault.com

Format EXACTLY:
POST: [content]
HASHTAGS: ${SEO_HASHTAGS.linkedin}`;

    case 'twitter':
      return `${baseInstructions}

Write a Twitter/X thread of 3 tweets matching the post type above.
- Each tweet under 280 characters
- Thread flows naturally from hook to value to CTA

Format EXACTLY:
TWEET1: [hook tweet]
TWEET2: [value tweet]
TWEET3: [CTA tweet - include residualvault.com]
HASHTAGS: ${SEO_HASHTAGS.twitter}`;

    case 'facebook':
      return `${baseInstructions}

Write a Facebook post (100-150 words) matching the post type above.
- Conversational and engaging
- End with a question
- Include CTA to residualvault.com

Format EXACTLY:
POST: [content]
HASHTAGS: ${SEO_HASHTAGS.facebook}`;

    case 'instagram':
      return `${baseInstructions}

Write a 30-second Instagram Reels VIDEO SCRIPT matching the post type above.
- Opens with attention-grabbing hook (first 3 seconds)
- Delivers clear value about crypto staking
- Ends with: "Visit residualvault.com - link in bio!"
- Written to be spoken by AI voiceover
- Include [visual direction] notes in brackets

Format EXACTLY:
SCRIPT: [30-second spoken script with visual directions]
CAPTION: [Instagram caption 50-80 words with emojis]
HASHTAGS: ${SEO_HASHTAGS.instagram}`;

    case 'reddit':
      return `${baseInstructions}

Write an authentic Reddit post matching the post type above.
- Community-first, NOT promotional
- Lead with genuine value
- 100-200 words

Format EXACTLY:
TITLE: [post title]
BODY: [post body]
SUBREDDIT: CryptoCurrency`;

    case 'youtube':
      return `${baseInstructions}

Write a 60-second YouTube Shorts VIDEO SCRIPT matching the post type above.
- Opens with powerful hook (first 5 seconds)
- 3 key value points about crypto staking
- Ends with: "Visit residualvault.com to compare 150+ staking protocols free!"
- Written to be spoken by AI voiceover
- Include [visual direction] notes in brackets

Format EXACTLY:
TITLE: [YouTube Shorts title - catchy and SEO optimized]
SCRIPT: [60-second spoken script with visual directions]
DESCRIPTION: [YouTube description 80-100 words]
HASHTAGS: ${SEO_HASHTAGS.youtube}`;

    default:
      return `Write a social media post about crypto staking for ${platformName}. Include these keywords: ${keywordSubset.join(', ')}. CTA: visit residualvault.com`;
  }
}

function parseContent(platformName, text) {
  let content = '';
  let hashtags = '';

  switch(platformName) {
    case 'twitter':
      const t1 = text.match(/TWEET1:\s*(.+?)(?=TWEET2:|$)/s)?.[1]?.trim() || '';
      const t2 = text.match(/TWEET2:\s*(.+?)(?=TWEET3:|$)/s)?.[1]?.trim() || '';
      const t3 = text.match(/TWEET3:\s*(.+?)(?=HASHTAGS:|$)/s)?.[1]?.trim() || '';
      content = [t1, t2, t3].filter(Boolean).join('\n\n---\n\n');
      hashtags = text.match(/HASHTAGS:\s*(.+?)$/s)?.[1]?.trim() || SEO_HASHTAGS.twitter;
      break;
    case 'reddit':
      const title = text.match(/TITLE:\s*(.+?)(?=BODY:|$)/s)?.[1]?.trim() || '';
      const body = text.match(/BODY:\s*(.+?)(?=SUBREDDIT:|$)/s)?.[1]?.trim() || '';
      content = `${title}\n\n${body}`;
      hashtags = 'CryptoCurrency';
      break;
    case 'instagram':
      const script = text.match(/SCRIPT:\s*(.+?)(?=CAPTION:|$)/s)?.[1]?.trim() || '';
      const caption = text.match(/CAPTION:\s*(.+?)(?=HASHTAGS:|$)/s)?.[1]?.trim() || '';
      content = `🎬 VIDEO SCRIPT (30 sec Reel):\n\n${script}\n\n📝 CAPTION:\n${caption}`;
      hashtags = text.match(/HASHTAGS:\s*(.+?)$/s)?.[1]?.trim() || SEO_HASHTAGS.instagram;
      break;
    case 'youtube':
      const ytTitle = text.match(/TITLE:\s*(.+?)(?=SCRIPT:|$)/s)?.[1]?.trim() || '';
      const ytScript = text.match(/SCRIPT:\s*(.+?)(?=DESCRIPTION:|$)/s)?.[1]?.trim() || '';
      const ytDesc = text.match(/DESCRIPTION:\s*(.+?)(?=HASHTAGS:|$)/s)?.[1]?.trim() || '';
      content = `🎬 VIDEO TITLE: ${ytTitle}\n\n📹 SCRIPT (60 sec Short):\n\n${ytScript}\n\n📝 DESCRIPTION:\n${ytDesc}`;
      hashtags = text.match(/HASHTAGS:\s*(.+?)$/s)?.[1]?.trim() || SEO_HASHTAGS.youtube;
      break;
    default:
      content = text.match(/POST:\s*(.+?)(?=HASHTAGS:|$)/s)?.[1]?.trim() || text;
      hashtags = text.match(/HASHTAGS:\s*(.+?)$/s)?.[1]?.trim() || SEO_HASHTAGS[platformName] || '';
  }

  return { content, hashtags };
}

async function generatePostsForPlatform(platformName, keywords) {
  const postTypes = POST_TYPES[platformName];
  const scheduleTimes = POSTING_SCHEDULE[platformName];
  const results = [];

  for (let i = 0; i < 3; i++) {
    try {
      const postType = postTypes[i];
      const scheduledTime = scheduleTimes[i];

      console.log(`[ContentAgent] Generating ${platformName} post ${i+1}/3 (${scheduledTime} UTC)...`);

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [{ role: 'user', content: buildPrompt(platformName, postType, keywords, i) }]
        },
        {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: 30000
        }
      );

      const text = response.data.content[0].text;
      const { content, hashtags } = parseContent(platformName, text);

      // Schedule posts across the next 7 days
      const daysAhead = Math.floor(i / 3) + Math.floor(Math.random() * 5) + 1;
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + daysAhead);
      const dateStr = scheduledDate.toISOString().split('T')[0];

      const result = await pool.query(
        `INSERT INTO content_posts (platform, content, hashtags, scheduled_date, scheduled_time, status)
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
        [platformName, content, hashtags, dateStr, scheduledTime]
      );

      console.log(`[ContentAgent] ✅ ${platformName} post ${i+1} saved (id: ${result.rows[0].id}, scheduled: ${dateStr} ${scheduledTime} UTC)`);
      results.push(true);

      // Delay between API calls
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (err) {
      console.error(`[ContentAgent] ❌ ${platformName} post ${i+1} failed:`, err.message);
      results.push(false);
    }
  }

  return results.filter(Boolean).length;
}

async function generateWeeklyContent() {
  console.log('[ContentAgent] 🚀 Starting weekly content generation (3 posts per platform)...');

  if (!CLAUDE_API_KEY) {
    console.error('[ContentAgent] ❌ ANTHROPIC_API_KEY not set in .env');
    return;
  }

  const allKeywords = await getActiveKeywords();
  console.log(`[ContentAgent] 📚 Loaded ${allKeywords.length} keywords from database`);

  const weeklyKeywords = getWeeklyKeywords(allKeywords);
  console.log(`[ContentAgent] 🎯 This week's focus keywords: ${weeklyKeywords.join(', ')}`);

  const platforms = ['linkedin', 'twitter', 'facebook', 'instagram', 'reddit', 'youtube'];
  let totalSuccess = 0;

  for (const platform of platforms) {
    const count = await generatePostsForPlatform(platform, weeklyKeywords);
    totalSuccess += count;
    console.log(`[ContentAgent] ${platform}: ${count}/3 posts created`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n[ContentAgent] ✅ Complete: ${totalSuccess}/18 posts created`);
  console.log('[ContentAgent] 📋 Posts pending in /rv-control dashboard');
  console.log('[ContentAgent] 🎬 Instagram and YouTube contain video scripts for videoAgent.js');
  console.log('[ContentAgent] ⏰ All posts scheduled at optimal global times');
}

module.exports = { generateWeeklyContent };
