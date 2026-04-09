'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class BrandVoiceAuditor extends BaseAgent {
  constructor() {
    super({
      name:      'Brand Voice Auditor',
      role:      'You are a brand strategist and copy editor responsible for maintaining ResidualVault\'s consistent brand voice across all content. You ensure every piece of communication is aligned with the brand guidelines, tone, and messaging hierarchy.',
      model:     'claude-opus-4-5',
      schedule:  '0 9 * * *',   // Daily at 9 AM
      maxTokens: 4096,
    });

    // Brand guidelines encoded directly
    this.brandGuidelines = {
      voice:   ['Confident', 'Empowering', 'Trustworthy', 'Approachable', 'Expert'],
      tone:    'Aspirational yet realistic. We inspire without hype. We educate without condescension.',
      avoid:   ['get rich quick', 'guaranteed income', 'passive money machine', 'overnight success', 'no work required'],
      prefer:  ['build wealth', 'strategic income', 'financial freedom', 'proven strategies', 'sustainable growth'],
      audience: 'Ambitious entrepreneurs and side-hustlers aged 25-45 seeking financial independence.',
    };
  }

  async auditContent(content, contentType) {
    return this.ask(`
You are auditing content for brand voice consistency for ResidualVault.

BRAND GUIDELINES:
${JSON.stringify(this.brandGuidelines, null, 2)}

CONTENT TO AUDIT (${contentType}):
${content.substring(0, 2000)}

Evaluate:
1. Voice alignment (Confident, Empowering, Trustworthy, Approachable, Expert)
2. Prohibited phrases usage
3. Preferred language usage
4. Tone appropriateness for audience
5. Headline and CTA effectiveness
6. Consistency with brand promise

Output JSON:
{
  "score": 0-100,
  "grade": "A|B|C|D|F",
  "voiceAlignment": { "confident": 0-10, "empowering": 0-10, "trustworthy": 0-10, "approachable": 0-10, "expert": 0-10 },
  "violations": [{ "phrase": "string", "issue": "string", "suggestion": "string" }],
  "strengths": ["string"],
  "improvements": ["string"],
  "revisedOpening": "string",
  "approved": boolean
}
`);
  }

  async generateBrandReport() {
    return this.ask(`
Create a weekly brand voice status report for ResidualVault.

Include:
1. Brand voice consistency score trend (assume improving trend)
2. Top 3 brand voice wins this week
3. Top 3 areas needing improvement
4. Recommended brand voice training topics for the content team
5. One "brand voice example of the week" — a perfectly on-brand paragraph about building passive income

Output JSON:
{
  "weekOf": "${new Date().toISOString().split('T')[0]}",
  "overallScore": 0-100,
  "trend": "improving|stable|declining",
  "wins": ["string"],
  "improvements": ["string"],
  "trainingTopics": ["string"],
  "exampleParagraph": "string",
  "recommendations": ["string"]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running brand voice audit');

    const recentContent = db.getGeneratedContent(30);
    const auditResults  = [];
    let totalScore      = 0;
    let violationCount  = 0;

    for (const item of recentContent.slice(0, 8)) {
      if (!item.content || item.content.length < 50) continue;
      try {
        const raw    = await this.auditContent(item.content, item.content_type);
        const result = this.parseJSON(raw) || { score: 50, approved: false };

        totalScore    += result.score || 50;
        violationCount += (result.violations || []).length;

        if (result.score < 60 || !result.approved) {
          await this.reportIssue(
            result.score < 40 ? 'high' : 'medium',
            `Brand Voice Violation in ${item.content_type}`,
            `Content ID ${item.id} scored ${result.score}/100. Violations: ${(result.violations || []).map(v => v.phrase).join(', ')}`
          );
        }

        auditResults.push({ contentId: item.id, type: item.content_type, score: result.score, approved: result.approved });
      } catch (err) {
        this._log('error', `Audit failed for content ${item.id}: ${err.message}`);
      }
    }

    const avgScore = auditResults.length ? Math.round(totalScore / auditResults.length) : 0;

    // Weekly brand report
    const rawReport = await this.generateBrandReport();
    const brandReport = this.parseJSON(rawReport) || {};

    await this.saveReport(
      'brand-audit',
      `Brand Voice Audit — Avg Score: ${avgScore}/100, Violations: ${violationCount}`,
      JSON.stringify({ auditResults, brandReport }, null, 2),
      avgScore < 60 ? 'high' : 'normal'
    );

    return { audited: auditResults.length, avgScore, violationCount };
  }
}

module.exports = BrandVoiceAuditor;

if (require.main === module) {
  const agent = new BrandVoiceAuditor();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
