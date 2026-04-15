'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class LegalComplianceAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Legal & Compliance Guardian',
      role:      'You are a legal and compliance expert specializing in digital marketing law, GDPR, FTC guidelines, copyright, and e-commerce regulations. You review all ResidualVault content and operations for legal risk and ensure full regulatory compliance.',
      model:     'claude-opus-4-6',
      schedule:  '30 10 * * 0',   // Daily at 6 AM
      timezone:  'America/Denver',
      maxTokens: 4096,
    });
  }

  async reviewContent(content, contentType) {
    return this.ask(`
Review this ${contentType} for ResidualVault for legal and compliance issues:

CONTENT:
${content}

Check for:
1. FTC disclosure requirements (affiliate links, paid promotions, testimonials)
2. GDPR/CCPA compliance language
3. Copyright and trademark infringement
4. Income claim regulations (required disclaimers for earnings claims)
5. Email marketing compliance (CAN-SPAM, GDPR)
6. Terms of service violations
7. Data collection and privacy disclosures
8. Misleading advertising claims

Output JSON:
{
  "compliant": boolean,
  "riskLevel": "low|medium|high|critical",
  "issues": [
    {
      "regulation": "string",
      "severity": "low|medium|high|critical",
      "description": "string",
      "requiredAction": "string",
      "suggestedFix": "string"
    }
  ],
  "recommendations": ["string"],
  "approvalStatus": "approved|needs_revision|rejected"
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running daily compliance audit');

    // Pull recent generated content to review
    const recentContent = db.getGeneratedContent(20);

    const auditResults = [];
    let highRiskCount  = 0;

    // Review a sample of recent content
    for (const item of recentContent.slice(0, 5)) {
      if (!item.content) continue;
      try {
        const raw    = await this.reviewContent(item.content.substring(0, 2000), item.content_type);
        const result = this.parseJSON(raw) || {};

        if (['high', 'critical'].includes(result.riskLevel)) {
          highRiskCount++;
          await this.reportIssue(
            result.riskLevel,
            `Compliance Issue in ${item.content_type}`,
            `Content ID ${item.id} flagged: ${result.issues?.[0]?.description || 'See report'}`
          );
        }

        auditResults.push({ contentId: item.id, type: item.content_type, ...result });
      } catch (err) {
        this._log('error', `Failed to review content ${item.id}: ${err.message}`);
      }
    }

    // General compliance checklist
    const checklistRaw = await this.ask(`
Generate a weekly compliance checklist for ResidualVault (digital marketing / passive income platform) covering:
1. Privacy policy freshness check
2. Cookie consent verification
3. FTC disclosure placement
4. Terms of service review
5. GDPR data retention audit
6. Email unsubscribe functionality
7. Income disclaimer placement

Output JSON:
{
  "checklistDate": "${new Date().toISOString().split('T')[0]}",
  "items": [
    { "category": "string", "check": "string", "status": "ok|review|urgent", "notes": "string" }
  ],
  "overallStatus": "green|yellow|red",
  "nextReviewDate": "string"
}
`);

    const checklist = this.parseJSON(checklistRaw) || {};

    const reportContent = JSON.stringify({ contentAudit: auditResults, checklist }, null, 2);
    const priority = highRiskCount > 0 || checklist.overallStatus === 'red' ? 'high' : 'normal';

    await this.saveReport(
      'compliance-audit',
      `Daily Compliance Audit — ${highRiskCount} high-risk items, Status: ${checklist.overallStatus || 'N/A'}`,
      reportContent,
      priority
    );

    if (highRiskCount > 0) {
      await this.reportIssue(
        'high',
        `${highRiskCount} Compliance Violations Found`,
        'Review the compliance audit report immediately. Content may need revision before publishing.'
      );
    }

    return { audited: auditResults.length, highRiskCount, checklistStatus: checklist.overallStatus };
  }
}

module.exports = LegalComplianceAgent;

if (require.main === module) {
  const agent = new LegalComplianceAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
