'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class PartnershipScout extends BaseAgent {
  constructor() {
    super({
      name:      'Partnership Scout',
      role:      'You are the Strategic Partnerships Director for ResidualVault. You identify, evaluate, and develop high-value partnership opportunities including affiliate programs, co-marketing initiatives, technology integrations, and joint ventures that expand reach and accelerate growth.',
      model:     'claude-opus-4-5',
      schedule:  '0 9 * * 2',   // Tuesdays at 9 AM
      maxTokens: 6144,
    });
  }

  async identifyPartners(category) {
    return this.ask(`
Identify high-value partnership opportunities for ResidualVault in the "${category}" category.

RESIDUALVAULT PROFILE:
- Platform: Passive income building through digital marketing
- Users: Entrepreneurs, side-hustlers, digital nomads
- Revenue models: SaaS subscriptions, digital courses, affiliate
- Values: Education, empowerment, financial freedom

Identify 10 ideal partners with:
1. Why they're a strong fit
2. Mutual value exchange
3. Partnership type (affiliate, co-marketing, integration, JV)
4. Estimated reach/impact
5. Outreach approach

Output JSON:
{
  "category": "${category}",
  "partners": [
    {
      "rank": number,
      "name": "string",
      "type": "affiliate|co-marketing|integration|joint-venture|content",
      "website": "string",
      "audience": "string",
      "audienceSize": "string",
      "fit": "string",
      "theirValue": "string",
      "ourValue": "string",
      "estimatedReach": "string",
      "estimatedRevImpact": "string",
      "outreachSubject": "string",
      "outreachOpening": "string",
      "priority": "A|B|C"
    }
  ],
  "topPick": "string",
  "outreachCalendar": "string"
}
`);
  }

  async generateOutreachTemplate(partnerName, partnerType) {
    return this.ask(`
Write a compelling partnership outreach email from ResidualVault to ${partnerName} (${partnerType} partnership).

Requirements:
- Subject line that gets opened
- Personalised opening (reference their work)
- Clear value proposition for them
- Specific partnership proposal
- Easy next step
- Professional yet warm tone

Output JSON:
{
  "subject": "string",
  "preview": "string",
  "body": "string",
  "followUpDay3": "string",
  "followUpDay7": "string"
}
`);
  }

  async buildPartnershipPipeline() {
    return this.ask(`
Create a strategic partnership pipeline framework for ResidualVault for the next quarter.

Include:
1. Target partner categories with rationale
2. Pipeline stages and criteria
3. Evaluation scorecard
4. Negotiation framework
5. Success metrics per partnership type
6. Risk assessment

Output JSON:
{
  "quarterGoal": "string",
  "targetCategories": [{ "category": "string", "reason": "string", "targetCount": number, "timelineWeeks": number }],
  "pipelineStages": [{ "stage": "string", "criteria": ["string"], "avgDuration": "string", "successRate": "string" }],
  "evaluationScorecard": [{ "criterion": "string", "weight": "string", "passingScore": "string" }],
  "partnershipTypes": [{ "type": "string", "avgRevShare": "string", "minTerm": "string" }],
  "kpis": [{ "metric": "string", "target": "string" }]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Scouting partnership opportunities');

    const categories = ['Digital Marketing Tools', 'Affiliate Networks', 'Business Education'];
    const results    = [];

    for (const category of categories) {
      try {
        const raw      = await this.identifyPartners(category);
        const partners = this.parseJSON(raw) || {};

        await this.saveContent(
          'partnerships',
          `Partnership Opportunities: ${category}`,
          JSON.stringify((partners.partners || []).slice(0, 5), null, 2),
          null,
          { category, totalIdentified: (partners.partners || []).length, topPick: partners.topPick }
        );

        const priorityA = (partners.partners || []).filter(p => p.priority === 'A');
        results.push({ category, total: (partners.partners || []).length, priorityA: priorityA.length });

        // Generate outreach for top partner
        if (priorityA.length > 0) {
          const top = priorityA[0];
          const outreachRaw = await this.generateOutreachTemplate(top.name, top.type);
          const outreach    = this.parseJSON(outreachRaw) || {};
          await this.saveContent('outreach-template', `Outreach: ${top.name}`, outreach.body || '', null, { subject: outreach.subject });
        }
      } catch (err) {
        this._log('error', `Partnership scouting failed for ${category}: ${err.message}`);
        results.push({ category, status: 'failed' });
      }
    }

    const pipelineRaw = await this.buildPartnershipPipeline();
    const pipeline    = this.parseJSON(pipelineRaw) || {};

    await this.saveReport(
      'partnerships',
      `Weekly Partnership Report — ${results.reduce((s, r) => s + (r.priorityA || 0), 0)} priority-A prospects`,
      JSON.stringify({ categories: results, pipeline }, null, 2)
    );

    return { categories: results.length, priorityPartners: results.reduce((s, r) => s + (r.priorityA || 0), 0) };
  }
}

module.exports = PartnershipScout;

if (require.main === module) {
  const agent = new PartnershipScout();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
