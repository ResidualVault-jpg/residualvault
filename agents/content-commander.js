'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class ContentCommander extends BaseAgent {
  constructor() {
    super({
      name:      'Content Commander',
      role:      'You are the Head of Content for ResidualVault. You oversee the entire content creation pipeline, commission new content, set editorial standards, manage content quality, and ensure every piece drives measurable business outcomes.',
      model:     'claude-opus-4-6',
      schedule:  '30 7 * * 0',   // Daily at 8 AM
      timezone:  'America/Denver',
      maxTokens: 8096,
    });
  }

  async writeBlogPost(topic, keywords) {
    return this.ask(`
Write a comprehensive, SEO-optimised blog post for ResidualVault.

TOPIC: ${topic}
TARGET KEYWORDS: ${keywords.join(', ')}
AUDIENCE: Entrepreneurs and side-hustlers seeking passive income
BRAND VOICE: Confident, empowering, educational, trustworthy — no hype

Requirements:
- 1500-2000 words
- H1, H2, H3 structure
- Introduction with strong hook
- 5-7 actionable sections
- Real examples and data where relevant
- Internal link placeholders [LINK: topic]
- Conclusion with clear CTA to ResidualVault
- Meta description (155 chars)

Output JSON:
{
  "title": "string",
  "metaDescription": "string",
  "slug": "string",
  "readingTime": "string",
  "primaryKeyword": "string",
  "content": "string (full HTML formatted article)",
  "outline": ["string"],
  "tags": ["string"],
  "internalLinks": ["string"],
  "featuredImagePrompt": "string"
}
`);
  }

  async createContentBriefs(count = 5) {
    return this.ask(`
Create ${count} detailed content briefs for the ResidualVault content team.

Each brief should cover a unique topic in the passive income / digital marketing space.
Briefs must be ready-to-execute for a writer.

Output JSON array:
[
  {
    "title": "string",
    "type": "blog|guide|case-study|listicle|tutorial",
    "targetKeyword": "string",
    "secondaryKeywords": ["string"],
    "targetWordCount": number,
    "audience": "string",
    "goal": "string",
    "angle": "string",
    "outline": ["string"],
    "mustInclude": ["string"],
    "mustAvoid": ["string"],
    "cta": "string",
    "priority": "high|medium|low",
    "deadline": "string"
  }
]
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running daily content production');

    // Generate content briefs
    const briefsRaw  = await this.createContentBriefs(5);
    const briefsParsed = this.parseJSON(briefsRaw);
    const briefs       = Array.isArray(briefsParsed) ? briefsParsed : [];

    for (const brief of briefs) {
      await this.saveContent(
        'content-brief',
        brief.title,
        JSON.stringify(brief, null, 2),
        null,
        { type: brief.type, priority: brief.priority, wordCount: brief.targetWordCount }
      );
    }

    // Write one full blog post per day
    const blogTopics = [
      { topic: 'How to Build a $5,000/Month Passive Income Stream in 6 Months', keywords: ['passive income', 'build passive income', 'passive income streams'] },
      { topic: 'Top 10 Digital Marketing Strategies for Solopreneurs in 2025', keywords: ['digital marketing strategies', 'solopreneur marketing', 'online marketing'] },
    ];

    const pick = blogTopics[new Date().getDate() % blogTopics.length];
    this._log('info', `Writing blog post: ${pick.topic}`);

    const postRaw = await this.writeBlogPost(pick.topic, pick.keywords);
    const post    = this.parseJSON(postRaw) || {};

    if (post.title) {
      await this.saveContent(
        'blog-post',
        post.title,
        post.content || '',
        null,
        { slug: post.slug, metaDescription: post.metaDescription, tags: post.tags, readingTime: post.readingTime }
      );
    }

    await this.saveReport(
      'content-production',
      `Daily Content Production — ${briefs.length} briefs, 1 blog post`,
      JSON.stringify({ briefs: briefs.map(b => b.title), blogPost: post.title }, null, 2)
    );

    return { briefs: briefs.length, blogPostTitle: post.title };
  }
}

module.exports = ContentCommander;

if (require.main === module) {
  const agent = new ContentCommander();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
