'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class AdvertisingMasterAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Advertising Master Agent',
      role:      'You are the Chief Advertising Officer for ResidualVault. You plan, create, and optimize multi-platform advertising campaigns across Google, Meta, LinkedIn, and YouTube. You specialise in conversion-focused ad copy, audience targeting, bid strategy, and ROI optimisation.',
      model:     'claude-opus-4-6',
      schedule:  '0 9 * * 0',   // Tuesdays at 8 AM
      timezone:  'America/Denver',
      maxTokens: 6144,
    });
  }

  async buildAdCampaign(platform, objective, audience, budget) {
    return this.ask(`
Create a complete advertising campaign for ResidualVault.

CAMPAIGN BRIEF:
- Platform: ${platform}
- Objective: ${objective}
- Target Audience: ${audience}
- Weekly Budget: $${budget}
- Brand: ResidualVault — passive income and digital marketing platform

Produce:
1. Campaign structure (campaigns → ad sets → ads)
2. 3 ad copy variations (headlines + body + CTA)
3. Audience targeting parameters
4. Bid strategy recommendation
5. Creative brief for images/videos
6. A/B test hypothesis
7. Expected performance benchmarks

Output JSON:
{
  "campaignName": "string",
  "platform": "${platform}",
  "objective": "${objective}",
  "budget": { "weekly": ${budget}, "dailyCap": number, "bidStrategy": "string" },
  "targeting": {
    "demographics": { "ageMin": number, "ageMax": number, "gender": "string" },
    "interests": ["string"],
    "behaviors": ["string"],
    "locations": ["string"],
    "exclusions": ["string"]
  },
  "adCopies": [
    {
      "variation": "A|B|C",
      "headline1": "string",
      "headline2": "string",
      "description": "string",
      "cta": "string",
      "hook": "string"
    }
  ],
  "creativeBrief": {
    "imageStyle": "string",
    "colorScheme": "string",
    "keyVisuals": ["string"],
    "videoLength": "string"
  },
  "abTest": { "hypothesis": "string", "variable": "string", "duration": "string" },
  "benchmarks": { "ctr": "string", "cpc": "string", "cpa": "string", "roas": "string" },
  "optimisationSchedule": "string"
}
`);
  }

  async generateAdCreatives(topic, count = 5) {
    return this.ask(`
Generate ${count} high-converting ad copy variations for ResidualVault on topic: "${topic}"

For each variation, write:
- Platform: choose the best-fit (Google Search, Facebook Feed, Instagram Story, LinkedIn)
- Format: specific to that platform's requirements
- Emotional trigger: the primary psychological hook
- Pain point addressed

Output JSON array:
[
  {
    "id": number,
    "platform": "string",
    "format": "string",
    "primaryHook": "string",
    "painPoint": "string",
    "headline": "string",
    "body": "string",
    "cta": "string",
    "characterCounts": { "headline": number, "body": number },
    "conversionAngle": "string"
  }
]
`);
  }

  async execute(context = {}) {
    this._log('info', 'Building weekly advertising campaigns');

    const campaigns = [
      { platform: 'Google Ads',     objective: 'Lead Generation',   audience: 'Entrepreneurs searching passive income strategies',   budget: 500 },
      { platform: 'Facebook/Meta',  objective: 'Conversion',        audience: 'Side-hustlers, 28-44, interested in financial freedom', budget: 400 },
      { platform: 'LinkedIn Ads',   objective: 'Brand Awareness',   audience: 'Business owners and managers, 30-50',                  budget: 200 },
    ];

    const results = [];

    for (const brief of campaigns) {
      try {
        const raw      = await this.buildAdCampaign(brief.platform, brief.objective, brief.audience, brief.budget);
        const campaign = this.parseJSON(raw) || {};

        await this.saveContent(
          'ad-campaign',
          campaign.campaignName || `${brief.platform} Campaign`,
          JSON.stringify(campaign.adCopies || [], null, 2),
          null,
          { platform: brief.platform, budget: brief.budget, benchmarks: campaign.benchmarks }
        );

        results.push({ platform: brief.platform, campaignName: campaign.campaignName, status: 'created' });
      } catch (err) {
        this._log('error', `Campaign creation failed for ${brief.platform}: ${err.message}`);
        results.push({ platform: brief.platform, status: 'failed', error: err.message });
      }
    }

    // Generate extra ad creatives
    const creativesRaw = await this.generateAdCreatives('Build passive income with ResidualVault', 5);
    const _creativesParsed = this.parseJSON(creativesRaw);
    const creatives        = Array.isArray(_creativesParsed) ? _creativesParsed : [];

    await this.saveContent(
      'ad-creatives',
      'Weekly Ad Creatives Bundle',
      JSON.stringify(creatives, null, 2),
      null,
      { count: creatives.length, generatedAt: new Date().toISOString() }
    );

    await this.saveReport(
      'advertising-campaigns',
      `Weekly Ad Campaigns — ${results.filter(r => r.status === 'created').length} campaigns created`,
      JSON.stringify({ campaigns: results, creatives: creatives.length }, null, 2)
    );

    return { campaigns: results.length, creatives: creatives.length };
  }
}

module.exports = AdvertisingMasterAgent;

if (require.main === module) {
  const agent = new AdvertisingMasterAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
