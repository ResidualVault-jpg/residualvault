'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class CustomerSuccessAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Customer Success Agent',
      role:      'You are the VP of Customer Success for ResidualVault. You monitor customer health, identify at-risk accounts, design intervention strategies, maximise LTV through proactive engagement, build success playbooks, and turn customers into raving advocates.',
      model:     'claude-opus-4-5',
      schedule:  '0 8 * * *',   // Daily at 8 AM
      maxTokens: 6144,
    });
  }

  async assessCustomerHealth() {
    return this.ask(`
Assess the customer health status for ResidualVault's user base.

CUSTOMER LIFECYCLE MODEL:
- Onboarding (days 1-14)
- Activation (first passive income generated)
- Growth (scaling income streams)
- Advocacy (referring others)

RISK SIGNALS TO EVALUATE:
1. No login in 7+ days
2. No content published in 14+ days
3. Subscription payment failed
4. Support ticket open > 3 days
5. Negative NPS score
6. Feature adoption < 30%
7. Goal not achieved after 30 days

Generate a customer health framework with intervention strategies.

Output JSON:
{
  "healthSegments": [
    {
      "segment": "string",
      "criteria": ["string"],
      "riskLevel": "low|medium|high|critical",
      "estimatedPct": "string",
      "churnProbability": "string",
      "intervention": {
        "name": "string",
        "channel": "string",
        "timing": "string",
        "message": "string",
        "goal": "string"
      }
    }
  ],
  "earlyWarningSystem": [{ "signal": "string", "threshold": "string", "automatedAction": "string" }],
  "healthScore": { "formula": "string", "weights": { "engagement": number, "adoption": number, "outcomes": number, "satisfaction": number } },
  "interventionPlaybooks": [
    { "scenario": "string", "steps": ["string"], "successCriteria": "string" }
  ]
}
`);
  }

  async buildOnboardingSequence() {
    return this.ask(`
Design the ultimate onboarding experience for new ResidualVault members.

GOAL: Get users to their first passive income milestone within 30 days

Design a day-by-day onboarding journey for days 1-30:
- Day 1: Immediate value delivery
- Week 1: Foundation building
- Week 2: First action/result
- Week 3: Scaling
- Week 4: Momentum

For each touchpoint include: channel, message, goal, success trigger.

Output JSON:
{
  "journeyName": "ResidualVault Fast Track",
  "goal": "First $100 passive income in 30 days",
  "days": [
    {
      "day": number,
      "phase": "string",
      "touchpoints": [
        {
          "channel": "string",
          "type": "email|in-app|sms|webinar|1-on-1",
          "subject": "string",
          "content": "string",
          "goal": "string",
          "successTrigger": "string"
        }
      ]
    }
  ],
  "milestones": [{ "day": number, "milestone": "string", "celebration": "string" }],
  "dropOffRescue": [{ "day": number, "signal": "string", "rescue": "string" }]
}
`);
  }

  async generateNPSSurvey() {
    return this.ask(`
Create a comprehensive NPS and customer satisfaction survey for ResidualVault.

Include:
1. Standard NPS question
2. Follow-up questions by score segment (Promoters, Passives, Detractors)
3. Product feedback questions
4. Feature request prompts
5. Testimonial collection (for Promoters)
6. Churn reason capture (for Detractors)

Output JSON:
{
  "surveyName": "ResidualVault Member Pulse",
  "frequency": "monthly",
  "questions": [
    {
      "id": number,
      "type": "nps|rating|multiple-choice|open-text|yes-no",
      "question": "string",
      "showTo": "all|promoters|passives|detractors",
      "required": boolean,
      "options": ["string"],
      "followUpId": "number|null"
    }
  ],
  "automations": [{ "segment": "string", "score": "string", "action": "string", "timing": "string" }],
  "testimonialCapture": "string"
}
`);
  }

  async createRetentionCampaign() {
    return this.ask(`
Design a retention campaign for at-risk ResidualVault subscribers.

AT-RISK DEFINITION: Users showing 2+ churn signals in the last 30 days

Create a 4-week re-engagement campaign with:
1. Week 1: Personal outreach + value reminder
2. Week 2: Educational content + quick win
3. Week 3: Special offer / incentive
4. Week 4: Final save attempt + feedback request

Output JSON:
{
  "campaignName": "string",
  "targetSegment": "string",
  "weeks": [
    {
      "week": number,
      "theme": "string",
      "touchpoints": [
        { "day": number, "channel": "string", "subject": "string", "content": "string", "offer": "string|null" }
      ]
    }
  ],
  "successMetrics": [{ "metric": "string", "target": "string" }],
  "exitSurvey": "string",
  "winbackOffer": "string"
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running customer success cycle');

    const [healthRaw, onboardingRaw, surveyRaw, retentionRaw] = await Promise.all([
      this.assessCustomerHealth(),
      this.buildOnboardingSequence(),
      this.generateNPSSurvey(),
      this.createRetentionCampaign(),
    ]);

    const health    = this.parseJSON(healthRaw)    || {};
    const onboarding = this.parseJSON(onboardingRaw) || {};
    const survey    = this.parseJSON(surveyRaw)    || {};
    const retention = this.parseJSON(retentionRaw) || {};

    // Alert on high churn risk segments
    const highRiskSegments = (health.healthSegments || []).filter(s => s.riskLevel === 'high' || s.riskLevel === 'critical');
    if (highRiskSegments.length > 0) {
      await this.reportIssue(
        'high',
        `${highRiskSegments.length} High-Risk Customer Segments Identified`,
        highRiskSegments.map(s => `${s.segment} (${s.churnProbability} churn risk)`).join(' | ')
      );
    }

    await this.saveContent('customer-health', 'Customer Health Framework', JSON.stringify(health, null, 2));
    await this.saveContent('onboarding-sequence', onboarding.journeyName || 'Onboarding Journey', JSON.stringify(onboarding, null, 2));
    await this.saveContent('retention-campaign', retention.campaignName || 'Retention Campaign', JSON.stringify(retention, null, 2));
    await this.saveContent('nps-survey', survey.surveyName || 'NPS Survey', JSON.stringify(survey, null, 2));

    await this.saveReport(
      'customer-success',
      `Customer Success Report — ${highRiskSegments.length} high-risk segments, Onboarding ready`,
      JSON.stringify({
        healthSegments:    (health.healthSegments || []).length,
        highRisk:          highRiskSegments.length,
        onboardingDays:    (onboarding.days || []).length,
        retentionWeeks:    (retention.weeks || []).length,
      }, null, 2),
      highRiskSegments.length > 2 ? 'high' : 'normal'
    );

    return {
      healthSegments:  (health.healthSegments || []).length,
      highRiskSegments: highRiskSegments.length,
      onboardingDays:  (onboarding.days || []).length,
      retentionWeeks:  (retention.weeks || []).length,
    };
  }
}

module.exports = CustomerSuccessAgent;

if (require.main === module) {
  const agent = new CustomerSuccessAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
