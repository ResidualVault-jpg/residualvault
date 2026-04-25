'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const path      = require('path');
const fs        = require('fs');

const GRAPHICS_DIR = path.join(__dirname, '../public/graphics');

const GRAPHIC_CATEGORIES = {
  'stat-cards':          { path: 'stat-cards',          description: 'Big stat numbers — protocol count, top APY, user metrics' },
  'apy-alerts':          { path: 'apy-alerts',          description: 'High APY alerts — protocol name, APY rate, chain, risk level' },
  'protocol-spotlights': { path: 'protocol-spotlights', description: 'Protocol deep dives — APY, chain, risk, lock period, description' },
  'quote-cards':         { path: 'quote-cards',         description: 'Branded quotes and value propositions' },
  'tip-cards':           { path: 'tip-cards',           description: 'Numbered staking tips with headline and body text' },
};

const PLATFORM_SIZE_MAP = {
  twitter:   'twitter',
  linkedin:  'twitter',
  blog:      'twitter',
  og:        'twitter',
  instagram: 'square',
  facebook:  'square',
  square:    'square',
};

class GraphicsImageAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Graphics/Image Agent',
      role:      'You are the visual content strategist for ResidualVault, a cryptocurrency staking comparison and intelligence platform. You select and assign branded graphics to content posts, matching the right graphic type to each piece of content.',
      model:     'claude-sonnet-4-6',
      schedule:  '45 10 * * 0',
      timezone:  'America/Denver',
      maxTokens: 2048,
    });
  }

  getAvailableGraphics() {
    const available = {};
    for (const [category, info] of Object.entries(GRAPHIC_CATEGORIES)) {
      const catDir = path.join(GRAPHICS_DIR, info.path);
      if (fs.existsSync(catDir)) {
        const files = fs.readdirSync(catDir).filter(f => f.endsWith('.png'));
        available[category] = {
          description: info.description,
          files: files.map(f => ({
            filename: f,
            path: `/graphics/${info.path}/${f}`,
            size: f.includes('square') ? 'square' : 'twitter',
          })),
        };
      }
    }
    return available;
  }

  selectGraphic(category, platform) {
    const sizeKey = PLATFORM_SIZE_MAP[platform] || 'twitter';
    const catDir = path.join(GRAPHICS_DIR, GRAPHIC_CATEGORIES[category]?.path || category);

    if (!fs.existsSync(catDir)) return null;

    const files = fs.readdirSync(catDir).filter(f => f.endsWith('.png'));
    const match = files.find(f => f.includes(sizeKey));
    if (!match) return null;

    return {
      localPath: path.join(catDir, match),
      publicUrl: `https://residualvault.com/graphics/${GRAPHIC_CATEGORIES[category].path}/${match}`,
      filename: match,
      category,
      size: sizeKey,
    };
  }

  async matchContentToGraphics(pendingContent) {
    const categories = Object.entries(GRAPHIC_CATEGORIES)
      .map(([k, v]) => `- ${k}: ${v.description}`)
      .join('\n');

    const raw = await this.ask(`
You are assigning branded graphics to social media and blog content for ResidualVault — a crypto staking comparison platform.

Available graphic categories:
${categories}

Content items to assign graphics to:
${JSON.stringify(pendingContent, null, 2)}

For each content item, pick the BEST matching graphic category based on the content topic.
Rules:
- APY or yield-related content -> apy-alerts
- Protocol reviews or comparisons -> protocol-spotlights
- Statistics, numbers, milestones -> stat-cards
- Motivational, educational, value prop -> quote-cards
- How-to tips, strategies, advice -> tip-cards

Output JSON array:
[
  {
    "contentId": number,
    "category": "stat-cards|apy-alerts|protocol-spotlights|quote-cards|tip-cards",
    "reason": "brief reason for the match"
  }
]
`);

    return this.parseJSON(raw) || [];
  }

  async execute(context = {}) {
    this._log('info', 'Running graphics assignment cycle');

    const available = this.getAvailableGraphics();
    const totalGraphics = Object.values(available).reduce((sum, cat) => sum + cat.files.length, 0);
    this._log('info', `${totalGraphics} branded graphics available across ${Object.keys(available).length} categories`);

    const db = require('../db');
    let pendingContent = [];
    try {
      const result = await db.query(`
        SELECT id, agent_name, content_type, title,
               LEFT(content::text, 200) as content_preview,
               metadata
        FROM generated_content
        WHERE metadata->>'status' = 'pending_review'
          AND (metadata->>'graphic_assigned' IS NULL OR metadata->>'graphic_assigned' = 'false')
          AND content_type IN ('social-post', 'twitter-post', 'linkedin-post', 'blog-post', 'email-newsletter')
        ORDER BY created_at DESC
        LIMIT 20
      `);
      pendingContent = result.rows;
    } catch (err) {
      this._log('error', `Failed to fetch pending content: ${err.message}`);
    }

    if (pendingContent.length === 0) {
      this._log('info', 'No pending content needs graphics');
      await this.saveReport('graphics-assignment', 'No content to assign graphics to', JSON.stringify({ available }));
      return { assigned: 0, available: totalGraphics };
    }

    this._log('info', `Found ${pendingContent.length} content items needing graphics`);
    const assignments = await this.matchContentToGraphics(pendingContent);

    let assignedCount = 0;
    for (const assignment of assignments) {
      const platform = pendingContent.find(c => c.id === assignment.contentId);
      if (!platform) continue;

      const platformKey = platform.content_type.replace('-post', '').replace('social', 'twitter');
      const graphic = this.selectGraphic(assignment.category, platformKey);

      if (graphic) {
        try {
          await db.query(
            `UPDATE generated_content
             SET metadata = metadata || $2::jsonb
             WHERE id = $1`,
            [assignment.contentId, JSON.stringify({
              graphic_assigned: true,
              graphic_category: assignment.category,
              graphic_url: graphic.publicUrl,
              graphic_file: graphic.filename,
              graphic_reason: assignment.reason,
            })]
          );
          assignedCount++;
          this._log('info', `Assigned ${assignment.category} graphic to content #${assignment.contentId}`);
        } catch (err) {
          this._log('error', `Failed to assign graphic to #${assignment.contentId}: ${err.message}`);
        }
      }
    }

    await this.saveReport(
      'graphics-assignment',
      `Graphics Assignment — ${assignedCount}/${pendingContent.length} content items got graphics`,
      JSON.stringify({ assignments, available: Object.keys(available) }, null, 2)
    );

    return { assigned: assignedCount, total: pendingContent.length, available: totalGraphics };
  }
}

module.exports = GraphicsImageAgent;

if (require.main === module) {
  const agent = new GraphicsImageAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
