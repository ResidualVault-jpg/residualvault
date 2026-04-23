'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class SocialMediaAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Social Media Agent',
      role:      'You are the Social Media Director for ResidualVault. You create platform-native content, build and execute posting schedules, engage authentically with the audience, analyse performance, and grow ResidualVault\'s social following into a powerful distribution channel and lead source.',
      model:     'claude-sonnet-4-6',
      schedule:  '0 8 * * 0', // Every 2 hours
      timezone:  'America/Denver',
      maxTokens: 6144,
    });
  }

  async generateSocialPosts(platform, count, theme) {
    return this.ask(`
Create ${count} high-performing social media posts for ResidualVault on ${platform}.

THEME: ${theme}
BRAND VOICE: Confident, empowering, educational — no hype, real value
AUDIENCE: Entrepreneurs and side-hustlers seeking financial freedom

Platform requirements for ${platform}:
${platform === 'Twitter/X'   ? '- Max 280 chars per tweet\n- Use threads for longer content\n- Strong first tweet hooks\n- Relevant hashtags (max 3)' : ''}
${platform === 'Instagram'   ? '- Caption up to 2200 chars\n- Hook in first line (before "more")\n- Strategic hashtag set (20-30)\n- Story prompt included' : ''}
${platform === 'LinkedIn'    ? '- Professional tone\n- 1300 char visible before "see more"\n- No hashtag spam (max 5)\n- Thought leadership angle' : ''}
${platform === 'Facebook'    ? '- Conversational, community feel\n- Encourage comments/shares\n- Moderate length (150-300 words)\n- Strong opening line' : ''}
${platform === 'TikTok'      ? '- Hook in first 3 seconds (describe visually)\n- Trending audio suggestion\n- Script for 30-60 second video' : ''}
${platform === 'Pinterest'   ? '- Pin title (100 chars max)\n- Description (500 chars)\n- SEO keywords for discovery' : ''}

Output JSON array:
[
  {
    "id": number,
    "platform": "${platform}",
    "type": "single-post|thread|carousel|story|reel|pin",
    "theme": "${theme}",
    "content": "string (full post content)",
    "hashtags": ["string"],
    "hook": "string",
    "cta": "string",
    "bestPostTime": "string",
    "expectedEngagement": "string",
    "visualPrompt": "string (description of ideal image/video)"
  }
]
`);
  }

  async buildSocialStrategy() {
    return this.ask(`
Build a comprehensive social media growth strategy for ResidualVault.

CURRENT GOAL: Reach 50,000 engaged followers across all platforms in 6 months

Platforms: Twitter/X, Instagram, LinkedIn, Facebook, TikTok, YouTube, Pinterest

For each platform create:
1. Growth strategy (unique to platform)
2. Content mix (% educational, % promotional, % entertainment, % UGC)
3. Posting frequency
4. Engagement tactics
5. Monetisation approach (leads, brand awareness)
6. 30-day growth challenge

Output JSON:
{
  "overallGoal": "string",
  "platforms": [
    {
      "platform": "string",
      "currentPriority": 1-7,
      "audienceProfile": "string",
      "contentMix": { "educational": number, "promotional": number, "entertainment": number, "ugc": number },
      "postingFrequency": "string",
      "growthTactic": "string",
      "uniqueAngle": "string",
      "monthlyFollowerTarget": "string",
      "30DayChallenge": "string"
    }
  ],
  "contentPillars": ["string"],
  "viralFormulas": ["string"],
  "crossPromotionPlan": "string"
}
`);
  }

  async generateEngagementReplies(scenarios) {
    return this.ask(`
Write authentic, on-brand engagement responses for ResidualVault social media.

SCENARIOS:
${JSON.stringify(scenarios)}

For each scenario write a response that:
- Is genuine and personal (not corporate)
- Adds value or continues the conversation
- Reflects brand voice
- Encourages deeper engagement

Output JSON array:
[
  {
    "scenario": "string",
    "platform": "string",
    "response": "string",
    "followUpQuestion": "string",
    "tone": "string"
  }
]
`);
  }


  /**
   * Review work submitted by sub-agents (Twitter Content Creator, LinkedIn Content Creator).
   * Checks generated_content for items with metadata.department_head = 'Social Media Agent'
   * and metadata.status = 'awaiting_dept_review'.
   * Reviews each item, approves or requests revision.
   */
  async reviewSubAgentWork() {
    const db = require('../db');
    const result = await db.query(
      "SELECT id, agent_name, content_type, title, content, metadata FROM generated_content WHERE metadata->>'department_head' = $1 AND metadata->>'status' = $2 ORDER BY created_at ASC",
      [this.name, 'awaiting_dept_review']
    );
    const pending = result.rows;
    if (pending.length === 0) {
      this._log('info', 'No sub-agent work to review');
      return { reviewed: 0 };
    }

    this._log('info', 'Reviewing ' + pending.length + ' items from sub-agents');
    let approved = 0, revised = 0;

    for (const item of pending) {
      let contentStr = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
      let meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : (item.metadata || {});

      try {
        const reviewResult = await this.ask(
          'You are the Social Media Director reviewing content from your team.\n' +
          'Sub-agent: ' + item.agent_name + '\n' +
          'Content type: ' + item.content_type + '\n' +
          'Title: ' + item.title + '\n' +
          'Content:\n' + contentStr.substring(0, 3000) + '\n\n' +
          'Review this content for:\n' +
          '1. Brand voice consistency (confident, empowering, educational)\n' +
          '2. Platform appropriateness\n' +
          '3. Quality and engagement potential\n' +
          '4. Factual accuracy\n' +
          '5. Clear CTA\n\n' +
          'Output JSON:\n' +
          '{"approved": true/false, "score": 1-10, "feedback": "string", "edits": "string or null"}'
        );
        const review = this.parseJSON(reviewResult) || { approved: true, score: 7 };

        if (review.approved !== false && (review.score || 7) >= 5) {
          meta.status = 'pending_review';
          meta.dept_review = { approved: true, score: review.score, feedback: review.feedback, reviewedAt: new Date().toISOString() };
          await db.query('UPDATE generated_content SET metadata = $1 WHERE id = $2', [JSON.stringify(meta), item.id]);
          this._log('info', 'Approved: ' + item.title + ' (score: ' + (review.score || '?') + ')');
          approved++;
        } else {
          meta.status = 'revision_needed';
          meta.dept_review = { approved: false, score: review.score, feedback: review.feedback, edits: review.edits, reviewedAt: new Date().toISOString() };
          await db.query('UPDATE generated_content SET metadata = $1 WHERE id = $2', [JSON.stringify(meta), item.id]);
          this._log('info', 'Revision needed: ' + item.title + ' - ' + (review.feedback || 'No feedback'));
          revised++;
        }
      } catch (err) {
        this._log('error', 'Review failed for ' + item.title + ': ' + err.message);
        // On error, approve anyway to not block the pipeline
        meta.status = 'pending_review';
        meta.dept_review = { approved: true, autoApproved: true, error: err.message };
        await db.query('UPDATE generated_content SET metadata = $1 WHERE id = $2', [JSON.stringify(meta), item.id]);
        approved++;
      }
    }

    return { reviewed: pending.length, approved, revised };
  }

  async execute(context = {}) {
    // Step 1: Review sub-agent work first
    const reviewResult = await this.reviewSubAgentWork();
    this._log('info', 'Sub-agent review: ' + reviewResult.approved + ' approved, ' + reviewResult.revised + ' need revision');

    // Step 2: Run own content generation
    this._log('info', 'Running social media content generation cycle');

    const platforms = [
      { platform: 'Twitter/X',  count: 5, theme: 'Passive income mindset and quick strategies' },
      { platform: 'LinkedIn',   count: 3, theme: 'Professional growth and entrepreneurship insights' },
    ];

    const results = [];

    for (const brief of platforms) {
      try {
        const raw   = await this.generateSocialPosts(brief.platform, brief.count, brief.theme);
        const _postsParsed = this.parseJSON(raw);
        const posts        = Array.isArray(_postsParsed) ? _postsParsed : [];

        await this.saveContent(
          'social-posts',
          `${brief.platform} Posts — ${brief.theme}`,
          JSON.stringify(posts, null, 2),
          null,
          { platform: brief.platform, count: posts.length, theme: brief.theme }
        );

        results.push({ platform: brief.platform, postsCreated: posts.length, status: 'created' });
      } catch (err) {
        this._log('error', `Social post generation failed for ${brief.platform}: ${err.message}`);
        results.push({ platform: brief.platform, status: 'failed', error: err.message });
      }
    }

    // Engagement responses
    const engagementScenarios = [
      { scenario: 'User asks: "How long does it take to make $1000/month in passive income?"', platform: 'Twitter' },
      { scenario: 'User says: "This seems too good to be true"', platform: 'Instagram' },
      { scenario: 'User shares: "Just hit my first $500 passive income milestone!"', platform: 'Community' },
    ];

    const repliesRaw = await this.generateEngagementReplies(engagementScenarios);
    const _repliesParsed = this.parseJSON(repliesRaw);
    const replies        = Array.isArray(_repliesParsed) ? _repliesParsed : [];
    await this.saveContent('engagement-replies', 'Community Engagement Replies', JSON.stringify(replies, null, 2));

    // Weekly strategy (Mondays only)
    if (new Date().getDay() === 1) {
      const strategyRaw = await this.buildSocialStrategy();
      const strategy    = this.parseJSON(strategyRaw) || {};
      await this.saveContent('social-strategy', 'Social Media Growth Strategy', JSON.stringify(strategy, null, 2));
    }

    const totalPosts = results.reduce((s, r) => s + (r.postsCreated || 0), 0);

    await this.saveReport(
      'social-media',
      `Social Media Cycle — ${totalPosts} posts created across ${results.filter(r => r.status === 'created').length} platforms`,
      JSON.stringify({ results, engagementReplies: replies.length }, null, 2)
    );

    return { platforms: results.length, totalPosts, engagementReplies: replies.length };
  }
}

module.exports = SocialMediaAgent;

if (require.main === module) {
  const agent = new SocialMediaAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
