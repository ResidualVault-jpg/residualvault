'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class IndustryResearcher extends BaseAgent {
  constructor() {
    super({
      name:      'Industry Researcher',
      role:      'You are the Head of Research for ResidualVault. You conduct deep-dive industry research, produce authoritative thought leadership reports, identify macro trends shaping the passive income and creator economy, and give ResidualVault the insight advantage needed to lead the market.',
      model:     'claude-opus-4-5',
      schedule:  '30 6 * * 0',   // Fridays at 7 AM
      timezone:  'America/Denver',
      maxTokens: 8096,
    });
  }

  async conductResearch(topic) {
    return this.ask(`
Conduct comprehensive industry research for ResidualVault on: "${topic}"

Research framework:
1. Market size and growth trajectory
2. Key players and ecosystem map
3. Consumer behaviour insights
4. Technology enablers and disruptors
5. Regulatory landscape
6. Business model innovations
7. Case studies of success and failure
8. 3-5 year outlook

This will be used as thought leadership content — make it authoritative and insightful.

Output JSON:
{
  "topic": "${topic}",
  "executiveSummary": "string (3 paragraphs)",
  "marketSize":       { "current": "string", "projected": "string", "cagr": "string", "sources": ["string"] },
  "keyPlayers":       [{ "name": "string", "role": "string", "significance": "string" }],
  "consumerInsights": [{ "insight": "string", "evidence": "string", "implication": "string" }],
  "enablers":         [{ "technology": "string", "impact": "string", "maturity": "string" }],
  "disruptions":      [{ "disruption": "string", "timeline": "string", "impact": "string" }],
  "caseStudies":      [{ "company": "string", "lesson": "string", "outcome": "string" }],
  "outlook":          { "bullCase": "string", "bearCase": "string", "baseCase": "string" },
  "residualVaultAngle": "string",
  "contentIdeas":     ["string"]
}
`);
  }

  async buildThoughtLeadershipPiece(topic, researchData) {
    return this.ask(`
Write an authoritative thought leadership piece for ResidualVault based on this research:

TOPIC: ${topic}
RESEARCH SUMMARY: ${JSON.stringify(researchData?.executiveSummary || 'N/A')}
MARKET SIZE: ${JSON.stringify(researchData?.marketSize || {})}
KEY INSIGHTS: ${JSON.stringify((researchData?.consumerInsights || []).slice(0, 3))}
OUTLOOK: ${JSON.stringify(researchData?.outlook || {})}

Write a 1200-word thought leadership article that:
- Positions ResidualVault as an authority
- Offers genuinely novel perspective (not obvious)
- Uses data and examples throughout
- Has a strong original thesis
- Ends with implications for our readers

Output JSON:
{
  "title":           "string",
  "subtitle":        "string",
  "thesis":          "string",
  "article":         "string (full article, HTML formatted)",
  "keyTakeaways":    ["string"],
  "quotableMoments": ["string"],
  "linkedinVersion": "string (800 chars max for LinkedIn post)",
  "twitterThread":   ["string (each tweet under 280 chars)"]
}
`);
  }

  async generateResearchCalendar() {
    return this.ask(`
Build a quarterly research and thought leadership calendar for ResidualVault.

QUARTER: ${new Date().toISOString().split('T')[0]} onwards

Plan 12 research topics across:
- Passive income strategies and trends
- Creator economy evolution
- Digital marketing innovations
- Financial technology for entrepreneurs
- AI and automation for solopreneurs

For each topic include: research depth, content output, distribution strategy, timing.

Output JSON:
{
  "quarter": "string",
  "researchPlan": [
    {
      "month": "string",
      "topic": "string",
      "angle": "string",
      "depth": "deep-dive|overview|analysis",
      "outputs": ["string"],
      "audience": "string",
      "distributionChannels": ["string"],
      "estimatedImpact": "string"
    }
  ],
  "quarterlyTheme": "string",
  "flagshipReport": "string"
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running industry research cycle');

    const weeklyTopics = [
      'The State of the Creator Economy 2025: Trends, Opportunities, and Threats',
      'How AI is Reshaping Passive Income Strategies for Solopreneurs',
      'The Rise of Micro-SaaS: Building $10K/month Businesses with No Code',
      'Digital Marketing ROI in 2025: What\'s Working and What\'s Dead',
    ];

    const topicIndex = new Date().getDay() % weeklyTopics.length;
    const topic      = context.topic || weeklyTopics[topicIndex];

    this._log('info', `Researching: ${topic}`);

    const researchRaw    = await this.conductResearch(topic);
    const research       = this.parseJSON(researchRaw) || {};

    const thoughtLeaderRaw = await this.buildThoughtLeadershipPiece(topic, research);
    const thoughtLeader    = this.parseJSON(thoughtLeaderRaw) || {};

    await this.saveContent(
      'research-report',
      `Research: ${topic}`,
      JSON.stringify(research, null, 2),
      null,
      { topic, marketSize: research.marketSize, outlook: research.outlook }
    );

    await this.saveContent(
      'thought-leadership',
      thoughtLeader.title || topic,
      thoughtLeader.article || '',
      null,
      {
        subtitle:       thoughtLeader.subtitle,
        keyTakeaways:   thoughtLeader.keyTakeaways,
        linkedinPost:   thoughtLeader.linkedinVersion,
        twitterThread:  thoughtLeader.twitterThread,
      }
    );

    // Research calendar (monthly)
    if (new Date().getDate() <= 7) {
      const calendarRaw = await this.generateResearchCalendar();
      const calendar    = this.parseJSON(calendarRaw) || {};
      await this.saveReport('research-calendar', `Research Calendar — ${calendar.quarter}`, JSON.stringify(calendar, null, 2));
    }

    await this.saveReport(
      'industry-research',
      `Weekly Research: ${topic.substring(0, 60)}...`,
      JSON.stringify({ research, thoughtLeader: thoughtLeader.title }, null, 2)
    );

    return {
      topic,
      articleTitle:   thoughtLeader.title,
      marketSize:     research.marketSize?.current,
      contentIdeas:   (research.contentIdeas || []).length,
    };
  }
}

module.exports = IndustryResearcher;

if (require.main === module) {
  const agent = new IndustryResearcher();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
