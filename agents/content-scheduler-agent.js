'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class ContentSchedulerAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Content Scheduler Agent',
      role:      'You are the Content Operations Manager for ResidualVault. You plan, prioritise, and schedule all content across every channel, ensuring a consistent publishing cadence, eliminating content gaps, and optimising publish times for maximum engagement.',
      model:     'claude-opus-4-5',
      schedule:  '45 7 * * 0',   // Daily at 7 AM
      timezone:  'America/Denver',
      maxTokens: 4096,
    });
  }

  async buildContentCalendar(daysAhead = 7) {
    const pendingContent = db.getGeneratedContent(20);
    const today = new Date().toISOString().split('T')[0];

    return this.ask(`
You are building a ${daysAhead}-day content publishing calendar for ResidualVault.

TODAY: ${today}
PENDING CONTENT INVENTORY: ${pendingContent.length} pieces available (types: ${[...new Set(pendingContent.map(c => c.content_type))].join(', ')})

Build a complete publishing schedule covering:
- Blog posts (3x/week)
- Social media (daily: 2 Instagram, 1 LinkedIn, 3 Twitter/X, 1 Facebook)
- Email newsletter (1x/week, Thursdays)
- YouTube (2x/week)
- Pinterest (5x/week)

For each slot include optimal posting time, content type, topic, and channel-specific notes.

Output JSON:
{
  "calendarStart": "${today}",
  "calendarEnd": "string",
  "totalSlots": number,
  "schedule": [
    {
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "channel": "string",
      "contentType": "string",
      "topic": "string",
      "status": "scheduled|draft|needs_creation",
      "priority": "high|medium|low",
      "notes": "string",
      "estimatedEngagement": "string"
    }
  ],
  "gaps": ["string"],
  "recommendations": ["string"],
  "contentNeeds": [{ "type": "string", "count": number, "urgency": "string" }]
}
`);
  }

  async identifyContentGaps() {
    return this.ask(`
Analyse the content schedule for ResidualVault and identify critical gaps.

Date: ${new Date().toISOString().split('T')[0]}

Common content gaps to check:
1. Channels with no planned content in next 48 hours
2. Missing evergreen content pillars
3. Underrepresented audience segments
4. Seasonal opportunities not yet capitalised
5. Competitor response opportunities
6. Trending topic alignment

Output JSON:
{
  "criticalGaps": [{ "channel": "string", "gap": "string", "urgency": "high|medium|low", "suggestedFix": "string" }],
  "opportunities": [{ "opportunity": "string", "channel": "string", "deadline": "string" }],
  "contentPillars": [{ "pillar": "string", "lastPublished": "string", "nextScheduled": "string", "status": "on-track|overdue|missing" }],
  "overallHealth": "green|yellow|red",
  "priorityActions": ["string"]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Building content schedule and gap analysis');

    const [calendarRaw, gapsRaw] = await Promise.all([
      this.buildContentCalendar(7),
      this.identifyContentGaps(),
    ]);

    const calendar = this.parseJSON(calendarRaw) || {};
    const gaps     = this.parseJSON(gapsRaw)     || {};

    if (gaps.criticalGaps && gaps.criticalGaps.filter(g => g.urgency === 'high').length > 0) {
      const highUrgency = gaps.criticalGaps.filter(g => g.urgency === 'high');
      await this.reportIssue(
        'medium',
        `${highUrgency.length} High-Priority Content Gaps Detected`,
        highUrgency.map(g => `${g.channel}: ${g.gap}`).join(' | ')
      );
    }

    if (gaps.overallHealth === 'red') {
      await this.reportIssue('high', 'Content Calendar Health Critical', 'Multiple channels have scheduling gaps. Immediate action required.');
    }

    await this.saveContent(
      'content-calendar',
      `7-Day Content Calendar — ${calendar.totalSlots || 0} slots`,
      JSON.stringify(calendar.schedule || [], null, 2),
      null,
      { totalSlots: calendar.totalSlots, contentNeeds: calendar.contentNeeds }
    );

    await this.saveReport(
      'content-schedule',
      `Daily Content Schedule — Health: ${gaps.overallHealth || 'N/A'}, Slots: ${calendar.totalSlots || 0}`,
      JSON.stringify({ calendar, gaps }, null, 2),
      gaps.overallHealth === 'red' ? 'high' : 'normal'
    );

    return {
      scheduledSlots: calendar.totalSlots || 0,
      contentNeeds: (calendar.contentNeeds || []).length,
      criticalGaps: (gaps.criticalGaps || []).filter(g => g.urgency === 'high').length,
      calendarHealth: gaps.overallHealth,
    };
  }
}

module.exports = ContentSchedulerAgent;

if (require.main === module) {
  const agent = new ContentSchedulerAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
