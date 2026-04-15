'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent   = require('./base-agent');
const nodemailer  = require('nodemailer');

class EmailConductor extends BaseAgent {
  constructor() {
    super({
      name:      'Email Conductor',
      role:      'You are the Email Marketing Director for ResidualVault. You design and execute high-converting email campaigns, build sophisticated automation sequences, optimise deliverability, segment lists for maximum relevance, and turn email into the #1 revenue-generating channel.',
      model:     'claude-opus-4-6',
      schedule:  '30 8 * * 0',   // Thursdays at 7 AM (newsletter day)
      timezone:  'America/Denver',
      maxTokens: 8096,
    });

    // Only initialise transporter if SMTP is configured
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      this.transporter = nodemailer.createTransporter({
        host:   process.env.SMTP_HOST,
        port:   parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
  }

  async writeWeeklyNewsletter() {
    const today = new Date().toISOString().split('T')[0];
    return this.ask(`
Write this week's ResidualVault newsletter.

DATE: ${today}
BRAND: ResidualVault — building passive income through digital marketing
AUDIENCE: Active subscribers who want to grow their income online

Newsletter requirements:
- Subject line + preview text (tested against spam filters)
- Warm opening (personal, not corporate)
- Main feature: one in-depth strategy or insight (300-400 words)
- Quick wins section: 3 bite-sized tips
- Community spotlight: fictional member success story
- Tool/resource of the week
- Motivational closing
- PS with a CTA

Output JSON:
{
  "subject":      "string (50 chars max)",
  "previewText":  "string (90 chars max)",
  "greeting":     "string",
  "mainFeature": {
    "headline": "string",
    "body":     "string",
    "cta":      "string",
    "ctaUrl":   "[LINK]"
  },
  "quickWins": [{ "tip": "string", "emoji": "string" }],
  "communitySpotlight": { "member": "string", "story": "string", "quote": "string" },
  "toolOfWeek":  { "name": "string", "description": "string", "link": "[LINK]" },
  "closing":     "string",
  "ps":          "string",
  "estimatedReadTime": "string"
}
`);
  }

  async buildAutomationSequence(goal, targetSegment, emailCount) {
    return this.ask(`
Build a ${emailCount}-email automation sequence for ResidualVault.

GOAL: ${goal}
TARGET SEGMENT: ${targetSegment}

For each email write:
1. Send timing (Day X after trigger)
2. Subject line + preview text
3. Full email body
4. Primary CTA
5. If-then branching rules (what happens based on open/click/no-action)

Output JSON:
{
  "sequenceName": "string",
  "goal": "${goal}",
  "targetSegment": "${targetSegment}",
  "trigger": "string",
  "emails": [
    {
      "emailNumber": number,
      "sendDay":     number,
      "subject":     "string",
      "preview":     "string",
      "body":        "string",
      "cta":         "string",
      "ctaUrl":      "[LINK]",
      "ifOpened":    "string",
      "ifClicked":   "string",
      "ifNoAction":  "string",
      "goalForEmail": "string"
    }
  ],
  "successMetrics": [{ "metric": "string", "benchmark": "string" }]
}
`);
  }

  async generateSubjectLineTests(topic, count = 10) {
    return this.ask(`
Generate ${count} subject line variations for a ResidualVault email about: "${topic}"

For each subject line include:
- The line itself
- Psychological trigger used
- Character count
- Spam word flag (true/false)
- Predicted open rate tier (low/medium/high)

Output JSON array:
[
  {
    "subjectLine": "string",
    "previewText": "string",
    "trigger":     "string",
    "chars":       number,
    "spamFlag":    boolean,
    "predictedTier": "low|medium|high",
    "abtestGroup":   "A|B|C|D|E"
  }
]
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running email conductor cycle');

    // Weekly newsletter
    const newsletterRaw = await this.writeWeeklyNewsletter();
    const newsletter    = this.parseJSON(newsletterRaw) || {};

    await this.saveContent(
      'email-newsletter',
      newsletter.subject || 'Weekly Newsletter',
      JSON.stringify(newsletter, null, 2),
      null,
      { estimatedReadTime: newsletter.estimatedReadTime }
    );

    // Build 3 automation sequences
    const sequences = [
      { goal: 'Onboard new free trial users and convert to paid', segment: 'New Trials',    count: 7  },
      { goal: 'Re-engage inactive subscribers',                   segment: 'Cold (60+ days)', count: 5 },
      { goal: 'Upsell monthly subscribers to annual plan',        segment: 'Monthly Subs',  count: 4  },
    ];

    const seqResults = [];
    for (const seq of sequences) {
      try {
        const raw    = await this.buildAutomationSequence(seq.goal, seq.segment, seq.count);
        const result = this.parseJSON(raw) || {};
        await this.saveContent('email-sequence', result.sequenceName || seq.goal, JSON.stringify(result, null, 2), null, { emailCount: seq.count });
        seqResults.push({ name: result.sequenceName, emails: seq.count, status: 'created' });
      } catch (err) {
        this._log('error', `Sequence failed: ${err.message}`);
        seqResults.push({ goal: seq.goal, status: 'failed' });
      }
    }

    // Subject line tests for next campaign
    const subjectLinesRaw = await this.generateSubjectLineTests('How to earn your first $1,000 in passive income', 10);
    const _slParsed   = this.parseJSON(subjectLinesRaw);
    const subjectLines = Array.isArray(_slParsed) ? _slParsed : [];

    await this.saveContent('subject-line-tests', 'Subject Line Test Suite', JSON.stringify(subjectLines, null, 2), null, { count: subjectLines.length });

    await this.saveReport(
      'email-marketing',
      `Email Report — Newsletter ready, ${seqResults.filter(s => s.status === 'created').length} sequences built`,
      JSON.stringify({ newsletter: newsletter.subject, sequences: seqResults, subjectLineTests: subjectLines.length }, null, 2)
    );

    return {
      newsletterSubject: newsletter.subject,
      sequencesBuilt:    seqResults.filter(s => s.status === 'created').length,
      subjectLineTests:  subjectLines.length,
    };
  }
}

module.exports = EmailConductor;

if (require.main === module) {
  const agent = new EmailConductor();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
