'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class PersonalizationEngine extends BaseAgent {
  constructor() {
    super({
      name:      'Personalization Engine',
      role:      'You are the Personalization Architect for ResidualVault. You design dynamic user segmentation strategies, personalised content journeys, and adaptive experiences that match the right message to the right user at the right moment to maximise engagement and LTV.',
      model:     'claude-opus-4-5',
      schedule:  '0 10 * * 0',   // Daily at 5 AM
      timezone:  'America/Denver',
      maxTokens: 6144,
    });
  }

  async buildUserSegments() {
    return this.ask(`
Design a comprehensive user segmentation framework for ResidualVault.

USER LIFECYCLE STAGES:
- Visitor → Lead → Trial → Customer → Power User → Advocate

SEGMENTATION DIMENSIONS:
- Behaviour (engagement, purchase history, content consumption)
- Demographics (role, income level, business stage)
- Psychographics (goals, pain points, motivations)
- Lifecycle stage
- Channel preference

Build 8-10 actionable segments with personalisation rules.

Output JSON:
{
  "segments": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "size": "estimated_pct",
      "criteria": { "behaviouralSignals": ["string"], "demographics": ["string"], "lifecycle": "string" },
      "goals": ["string"],
      "painPoints": ["string"],
      "preferredChannels": ["string"],
      "messagingStrategy": "string",
      "contentTypes": ["string"],
      "ctaStyle": "string",
      "offerType": "string",
      "nextBestAction": "string"
    }
  ],
  "segmentationRules": "string",
  "implementationPriority": ["string"]
}
`);
  }

  async designPersonalisationJourneys(segments) {
    return this.ask(`
Design personalised content journeys for the top 4 ResidualVault user segments.

SEGMENTS: ${JSON.stringify(segments.slice(0, 4).map(s => ({ id: s.id, name: s.name, lifecycle: s.criteria?.lifecycle })))}

For each segment create a 30-day personalisation journey:
- Trigger conditions
- Day 1/3/7/14/30 touchpoints
- Content recommendations per touchpoint
- A/B test suggestions

Output JSON:
{
  "journeys": [
    {
      "segmentId": "string",
      "segmentName": "string",
      "journeyName": "string",
      "touchpoints": [
        {
          "day": number,
          "channel": "string",
          "trigger": "string",
          "content": "string",
          "subject": "string",
          "goal": "string",
          "successMetric": "string"
        }
      ],
      "abTest": "string",
      "expectedLift": "string"
    }
  ]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Rebuilding personalisation framework');

    const segmentsRaw = await this.buildUserSegments();
    const segments    = this.parseJSON(segmentsRaw) || { segments: [] };

    const journeysRaw = await this.designPersonalisationJourneys(segments.segments || []);
    const journeys    = this.parseJSON(journeysRaw) || { journeys: [] };

    await this.saveContent(
      'personalisation',
      'User Segmentation Framework',
      JSON.stringify(segments, null, 2),
      null,
      { segmentCount: (segments.segments || []).length, journeyCount: (journeys.journeys || []).length }
    );

    await this.saveReport(
      'personalisation',
      `Personalisation Framework — ${(segments.segments || []).length} segments, ${(journeys.journeys || []).length} journeys`,
      JSON.stringify({ segments: segments.segments, journeys: journeys.journeys }, null, 2)
    );

    return {
      segments: (segments.segments || []).length,
      journeys: (journeys.journeys || []).length,
    };
  }
}

module.exports = PersonalizationEngine;

if (require.main === module) {
  const agent = new PersonalizationEngine();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
