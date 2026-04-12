'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class CommunityVoice extends BaseAgent {
  constructor() {
    super({
      name:      'Community Voice',
      role:      'You are the Community Manager for ResidualVault. You foster an engaged, supportive community of passive income builders by crafting authentic interactions, amplifying member voices, creating discussion starters, monitoring sentiment, and turning community insights into product and content intelligence.',
      model:     'claude-opus-4-5',
      schedule:  '15 8 * * 0', // Every 4 hours
      timezone:  'America/Denver',
      maxTokens: 4096,
    });
  }

  async analyseCommunitySentiment() {
    return this.ask(`
Analyse the community sentiment for ResidualVault based on typical patterns for a passive income / digital marketing community.

Assess sentiment across:
1. Product satisfaction
2. Content value
3. Community belonging
4. Success stories shared
5. Feature requests and pain points
6. Churn risk signals

Output JSON:
{
  "overallSentiment": "positive|neutral|mixed|negative",
  "sentimentScore": 0-100,
  "dimensions": {
    "productSatisfaction": { "score": 0-100, "trending": "up|stable|down", "topFeedback": "string" },
    "contentValue":        { "score": 0-100, "trending": "up|stable|down", "topFeedback": "string" },
    "communityBelonging":  { "score": 0-100, "trending": "up|stable|down", "topFeedback": "string" }
  },
  "risingTopics": ["string"],
  "painPoints": ["string"],
  "featureRequests": ["string"],
  "churnSignals": ["string"],
  "celebrationWins": ["string"],
  "actionItems": ["string"]
}
`);
  }

  async generateCommunityContent() {
    return this.ask(`
Create a week's worth of community engagement content for ResidualVault's online community.

Content types needed:
1. Daily discussion starters (7)
2. Weekly challenge prompt
3. Success story spotlight template
4. Weekly poll question
5. Educational thread (teach something valuable)
6. Motivational Monday message
7. Community guidelines reminder (friendly tone)

Output JSON:
{
  "weekOf": "${new Date().toISOString().split('T')[0]}",
  "discussionStarters": [
    { "day": "string", "post": "string", "expectedReplies": "string", "goal": "string" }
  ],
  "weeklyChallenge": { "title": "string", "description": "string", "prize": "string", "hashtag": "string" },
  "successSpotlightTemplate": "string",
  "weeklyPoll": { "question": "string", "options": ["string"] },
  "educationalThread": { "topic": "string", "content": "string" },
  "motivationalMonday": "string",
  "guidelinesReminder": "string"
}
`);
  }

  async generateResponseTemplates() {
    return this.ask(`
Create community response templates for common scenarios in the ResidualVault community.

Scenarios:
1. New member introduction
2. Member sharing first passive income milestone
3. Member frustrated with slow progress
4. Member asking about platform features
5. Member sharing a success story
6. Negative comment / complaint
7. Spam or rule violation
8. Member promoting another service

For each, write a warm, on-brand response that builds community.

Output JSON:
{
  "templates": [
    {
      "scenario": "string",
      "tone": "string",
      "response": "string",
      "followUpAction": "string"
    }
  ]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running community management cycle');

    const [sentimentRaw, contentRaw, templatesRaw] = await Promise.all([
      this.analyseCommunitySentiment(),
      this.generateCommunityContent(),
      this.generateResponseTemplates(),
    ]);

    const sentiment = this.parseJSON(sentimentRaw) || {};
    const content   = this.parseJSON(contentRaw)   || {};
    const templates = this.parseJSON(templatesRaw) || {};

    // Alert if sentiment is declining
    if (sentiment.overallSentiment === 'negative' || sentiment.sentimentScore < 50) {
      await this.reportIssue(
        'high',
        'Community Sentiment Alert',
        `Sentiment score: ${sentiment.sentimentScore}/100 — ${sentiment.overallSentiment}. Pain points: ${(sentiment.painPoints || []).join(', ')}`
      );
    }

    // Alert on churn signals
    if (sentiment.churnSignals && sentiment.churnSignals.length > 0) {
      await this.reportIssue(
        'medium',
        'Community Churn Signals Detected',
        sentiment.churnSignals.join(' | ')
      );
    }

    await this.saveContent(
      'community-content',
      `Weekly Community Content — ${new Date().toISOString().split('T')[0]}`,
      JSON.stringify(content, null, 2),
      null,
      { discussionCount: (content.discussionStarters || []).length }
    );

    await this.saveContent(
      'community-templates',
      'Community Response Templates',
      JSON.stringify(templates, null, 2),
      null,
      { templateCount: (templates.templates || []).length }
    );

    await this.saveReport(
      'community',
      `Community Report — Sentiment: ${sentiment.overallSentiment} (${sentiment.sentimentScore}/100)`,
      JSON.stringify({ sentiment, contentPlan: content.weekOf }, null, 2),
      sentiment.sentimentScore < 60 ? 'high' : 'normal'
    );

    return {
      sentiment:      sentiment.overallSentiment,
      sentimentScore: sentiment.sentimentScore,
      contentPieces:  (content.discussionStarters || []).length,
      templates:      (templates.templates || []).length,
    };
  }
}

module.exports = CommunityVoice;

if (require.main === module) {
  const agent = new CommunityVoice();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
