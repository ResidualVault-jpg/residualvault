'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class StakingAlphaAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Staking Alpha Weekly',
      role:      'You are the Staking Alpha newsletter writer for ResidualVault. You produce a concise weekly staking intelligence briefing that highlights APY movements, trending protocols, risk flag changes, and actionable staking opportunities. Your content is used for the weekly newsletter, Twitter threads, and LinkedIn posts.',
      model:     'claude-sonnet-4-6',
      schedule:  '30 6 * * 0',
      timezone:  'America/Denver',
      maxTokens: 8096,
    });
  }

  async execute() {
    this.logger.info('Generating weekly Staking Alpha briefing...');

    const topProtocols = await db.query(`
      SELECT p.name, p.slug, p.chain, p.category,
             COALESCE(vr.apy, 0) as current_apy
      FROM protocols p
      LEFT JOIN LATERAL (
        SELECT apy FROM vault_rewards WHERE protocol_id = p.id ORDER BY fetched_at DESC LIMIT 1
      ) vr ON true
      WHERE COALESCE(vr.apy, 0) > 0
      ORDER BY vr.apy DESC LIMIT 20
    `);

    const bigMovers = await db.query(`
      SELECT p.name, p.slug, p.chain,
             a.previous_apy, a.new_apy, a.change_percent, a.direction
      FROM apy_alerts a
      JOIN protocols p ON p.id = a.protocol_id
      WHERE a.created_at > NOW() - INTERVAL '7 days'
      ORDER BY ABS(a.change_percent) DESC LIMIT 10
    `);

    const totalProtocols = await db.query(`SELECT COUNT(*) as cnt FROM protocols`);

    const protocolData = topProtocols.rows.map(r =>
      `${r.name} (${r.chain}) — ${parseFloat(r.current_apy).toFixed(2)}% APY [${r.category}]`
    ).join('\n');

    const moverData = bigMovers.rows.length > 0
      ? bigMovers.rows.map(r =>
          `${r.name} (${r.chain}): ${parseFloat(r.previous_apy).toFixed(2)}% → ${parseFloat(r.new_apy).toFixed(2)}% (${r.direction === 'up' ? '↑' : '↓'} ${parseFloat(r.change_percent).toFixed(1)}%)`
        ).join('\n')
      : 'No significant APY changes this week.';

    const today = new Date().toISOString().split('T')[0];

    const prompt = `
Write the weekly "Staking Alpha" briefing for ResidualVault.

DATE: ${today}
TOTAL PROTOCOLS TRACKED: ${totalProtocols.rows[0].cnt}

TOP 20 PROTOCOLS BY APY:
${protocolData}

BIGGEST APY MOVERS THIS WEEK:
${moverData}

Write THREE pieces of content from this data:

1. TWITTER THREAD (5-7 tweets)
- First tweet must hook with "🔥 Staking Alpha | Week of ${today}" and a compelling stat
- Each tweet under 280 chars
- Include specific APY numbers and protocol names
- Final tweet: CTA to residualvault.com/leaderboard
- Use $TICKER format for crypto names where appropriate

2. LINKEDIN POST (1 professional post)
- Professional tone, 150-200 words
- Lead with a key insight or trend
- Include 2-3 specific data points
- CTA to residualvault.com
- 3-5 relevant hashtags

3. NEWSLETTER SECTION (the "Staking Alpha" section for the weekly email)
- 200-300 words
- "This Week in Staking" header
- Top 5 yields with APY
- Notable movers section
- One actionable tip
- CTA to explore protocols on residualvault.com

Output JSON:
{
  "weekOf": "${today}",
  "twitterThread": [
    { "tweetNumber": 1, "content": "string under 280 chars" }
  ],
  "linkedinPost": {
    "content": "string",
    "hashtags": ["string"]
  },
  "newsletterSection": {
    "headline": "string",
    "body": "string",
    "topYields": [{ "name": "string", "apy": "string", "chain": "string" }],
    "movers": [{ "name": "string", "change": "string", "direction": "up|down" }],
    "tip": "string"
  }
}`;

    const result = await this.ask(prompt);
    const parsed = this.parseJSON(result);

    if (!parsed) {
      await this.reportIssue('medium', 'Staking Alpha parse failure', 'Could not parse JSON from Claude response');
      await this.saveContent('staking-alpha-raw', `Staking Alpha Raw — ${today}`, result, null, { status: 'pending_review' });
      return { success: false, reason: 'parse_failure' };
    }

    // Save Twitter thread as individual posts
    if (parsed.twitterThread) {
      const threadContent = parsed.twitterThread.map(t => t.content).join('\n---\n');
      await this.saveContent('twitter-thread', `Staking Alpha Thread — ${today}`, threadContent, null, {
        status: 'pending_review',
        platform: 'twitter',
        contentSubType: 'thread',
        tweetCount: parsed.twitterThread.length
      });

      // Also save each tweet as individual posts for the social publisher
      for (const tweet of parsed.twitterThread) {
        await this.saveContent('social-post', `Staking Alpha Tweet ${tweet.tweetNumber} — ${today}`, JSON.stringify({
          platform: 'twitter',
          content: tweet.content,
          hashtags: [],
          isThread: true,
          threadPosition: tweet.tweetNumber,
          threadTotal: parsed.twitterThread.length
        }), null, {
          status: 'pending_review',
          platform: 'twitter',
          weekOf: today
        });
      }
    }

    // Save LinkedIn post
    if (parsed.linkedinPost) {
      await this.saveContent('social-post', `Staking Alpha LinkedIn — ${today}`, JSON.stringify({
        platform: 'linkedin',
        content: parsed.linkedinPost.content,
        hashtags: parsed.linkedinPost.hashtags || []
      }), null, {
        status: 'pending_review',
        platform: 'linkedin',
        weekOf: today
      });
    }

    // Save newsletter section
    if (parsed.newsletterSection) {
      await this.saveContent('newsletter-section', `Staking Alpha Newsletter — ${today}`, JSON.stringify(parsed.newsletterSection), null, {
        status: 'pending_review',
        contentSubType: 'staking-alpha',
        weekOf: today
      });
    }

    await this.saveReport('staking-alpha', `Staking Alpha Report — ${today}`, parsed);

    this.logger.info(`Staking Alpha generated: ${parsed.twitterThread?.length || 0} tweets, 1 LinkedIn post, 1 newsletter section`);
    return { success: true, tweets: parsed.twitterThread?.length || 0 };
  }
}

module.exports = StakingAlphaAgent;
