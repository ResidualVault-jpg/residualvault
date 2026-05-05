'use strict';

const BaseAgent = require('./base-agent');
const db = require('../db');

class ComplianceAutoResolver extends BaseAgent {
  constructor() {
    super({
      name: 'Compliance Auto-Resolver',
      role: 'You automatically resolve compliance violations flagged by the Legal & Compliance Guardian. You rewrite flagged content to fix FTC, TCPA, CAN-SPAM, GDPR, CCPA, and other regulatory violations while maintaining brand voice and marketing intent.',
      model: 'claude-opus-4-6',
      schedule: '45 10 * * 0',
      timezone: 'America/Denver',
      maxTokens: 8000,
    });
  }

  async execute(context) {
    this.log('info', 'Starting compliance auto-resolution scan');

    const alerts = await this._getUnresolvedComplianceAlerts();

    if (!alerts || alerts.length === 0) {
      this.log('info', 'No unresolved compliance alerts found');
      await this.saveReport('compliance-resolution', 'No Compliance Alerts', {
        summary: 'No unresolved compliance alerts',
        alertsProcessed: 0,
        timestamp: new Date().toISOString()
      });
      return { alertsProcessed: 0 };
    }

    this.log('info', `Found ${alerts.length} unresolved compliance alert(s)`);

    const results = [];

    for (const alert of alerts) {
      try {
        const result = await this._resolveAlert(alert);
        results.push(result);
      } catch (err) {
        this.log('error', `Failed to resolve alert ${alert.id}: ${err.message}`);
        results.push({
          alertId: alert.id,
          status: 'failed',
          error: err.message
        });
      }
    }

    const successCount = results.filter(r => r.status === 'resolved').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    this.log('info', `Resolved ${successCount}/${alerts.length} alerts (${failCount} failed)`);

    await this.saveReport('compliance-resolution', `Compliance Auto-Resolution: ${successCount} resolved, ${failCount} failed`, {
      summary: `Processed ${alerts.length} compliance alerts`,
      alertsProcessed: alerts.length,
      resolved: successCount,
      failed: failCount,
      details: results,
      timestamp: new Date().toISOString()
    });

    if (failCount > 0) {
      await this.reportIssue(
        'high',
        `${failCount} compliance alert(s) could not be auto-resolved`,
        `Manual review required. Failed alerts: ${results.filter(r => r.status === 'failed').map(r => r.alertId).join(', ')}`
      );
    }

    return { alertsProcessed: alerts.length, resolved: successCount, failed: failCount };
  }

  async _getUnresolvedComplianceAlerts() {
    const result = await db.query(`
      SELECT id, agent_name, type, message, details, created_at
      FROM system_alerts
      WHERE resolved = false
        AND agent_name = 'Legal & Compliance Guardian'
      ORDER BY
        CASE type
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        created_at ASC
    `);
    return result.rows || [];
  }

  async _resolveAlert(alert) {
    this.log('info', `Processing alert ${alert.id}: ${alert.type} — ${(alert.message || '').substring(0, 100)}`);

    const alertDetails = typeof alert.details === 'string' ? JSON.parse(alert.details) : (alert.details || {});
    const contentId = alertDetails.contentId || alertDetails.content_id || null;

    const report = await this._getComplianceReport();

    let originalContent = null;
    if (contentId) {
      originalContent = await this._getContent(contentId);
    } else {
      originalContent = await this._findContentFromReport(report, alert);
    }

    if (!originalContent) {
      this.log('info', `Alert ${alert.id}: No actionable content found — resolving as advisory`);
      await this._resolveAlertInDb(alert.id, 'resolved_advisory');
      return {
        alertId: alert.id,
        status: 'resolved',
        action: 'advisory_only',
        note: 'No specific content to rewrite — compliance guidance logged'
      };
    }

    const fixResult = await this._analyzeAndFix(originalContent, report, alert);

    if (fixResult.rewrittenContent) {
      await this._updateContent(originalContent.id, fixResult);
    }

    await this._resolveAlertInDb(alert.id, 'resolved_auto_fixed');

    await this.saveContent(
      'compliance_fix',
      'COMPLIANCE FIX: ' + (originalContent.title || 'Content #' + originalContent.id),
      this._buildFixSummary(fixResult, originalContent, alert),
      null,
      {
        status: 'compliance_fixed',
        originalContentId: originalContent.id,
        alertId: alert.id,
        violationsFixed: fixResult.violations.length,
        severity: alert.type
      }
    );

    this.log('info', `Alert ${alert.id}: Fixed ${fixResult.violations.length} violation(s) in content ${originalContent.id}`);

    return {
      alertId: alert.id,
      contentId: originalContent.id,
      status: 'resolved',
      action: 'content_rewritten',
      violationsFixed: fixResult.violations.length,
      violations: fixResult.violations
    };
  }

  async _getComplianceReport() {
    const result = await db.query(`
      SELECT id, report
      FROM agent_reports
      WHERE agent_name = 'Legal & Compliance Guardian'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    if (result.rows && result.rows.length > 0) {
      const row = result.rows[0];
      return typeof row.report === 'string' ? JSON.parse(row.report) : row.report;
    }
    return null;
  }

  async _getContent(contentId) {
    const result = await db.query(
      'SELECT id, agent_name, content_type, title, content, metadata, created_at FROM generated_content WHERE id = $1',
      [contentId]
    );
    return (result.rows && result.rows.length > 0) ? result.rows[0] : null;
  }

  async _findContentFromReport(report, alert) {
    if (!report) return null;

    // The report may have a nested stringified JSON in report.data
    let searchStr = JSON.stringify(report);
    if (report.data && typeof report.data === 'string') {
      searchStr += ' ' + report.data;
      try {
        const innerData = JSON.parse(report.data);
        if (innerData.contentAudit && Array.isArray(innerData.contentAudit)) {
          for (const audit of innerData.contentAudit) {
            if (audit.contentId) {
              const found = await this._getContent(audit.contentId);
              if (found) return found;
            }
          }
        }
        searchStr += ' ' + JSON.stringify(innerData);
      } catch (_) { /* not JSON, use as-is */ }
    }

    const contentIdMatch = searchStr.match(/contentId["\s:]*(\d+)/i);
    if (contentIdMatch) {
      return this._getContent(parseInt(contentIdMatch[1], 10));
    }

    const contentIdMatch2 = searchStr.match(/content[_\s]?(?:id|#)\s*[:=]?\s*(\d+)/i);
    if (contentIdMatch2) {
      return this._getContent(parseInt(contentIdMatch2[1], 10));
    }

    const alertMsg = alert.message || '';
    const msgMatch = alertMsg.match(/content[_\s]?(?:id|#)\s*[:=]?\s*(\d+)/i);
    if (msgMatch) {
      return this._getContent(parseInt(msgMatch[1], 10));
    }

    const result = await db.query(`
      SELECT id, agent_name, content_type, title, content, metadata, created_at
      FROM generated_content
      WHERE metadata->>'status' IN ('pending_review', 'ready_for_review', 'qa_failed')
        AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (result.rows && result.rows.length > 0) {
      for (const content of result.rows) {
        const bodyStr = typeof content.content === 'string' ? content.content : JSON.stringify(content.content);
        if (this._contentMatchesReport(bodyStr, report)) {
          return content;
        }
      }
    }

    return null;
  }

  _contentMatchesReport(bodyStr, report) {
    const reportStr = JSON.stringify(report).toLowerCase();
    const bodyLower = bodyStr.toLowerCase();

    let matchCount = 0;
    const phraseMatches = reportStr.match(/"([^"]{10,60})"/g);
    if (phraseMatches) {
      for (const phrase of phraseMatches.slice(0, 10)) {
        const cleaned = phrase.replace(/"/g, '').toLowerCase();
        if (bodyLower.includes(cleaned)) matchCount++;
      }
    }

    return matchCount >= 2;
  }

  async _analyzeAndFix(content, report, alert) {
    const bodyStr = typeof content.content === 'string' ? content.content : JSON.stringify(content.content, null, 2);
    const reportStr = report ? JSON.stringify(report, null, 2) : 'No detailed report available';

    const systemPrompt = 'You are a legal compliance specialist for ResidualVault, a cryptocurrency staking comparison platform (residualvault.com). You fix compliance violations in AI-generated marketing content. Always respond with valid JSON.';

    const userPrompt = `Fix all compliance violations in this content, ordered by severity (critical first).

ALERT SEVERITY: ${alert.type}
ALERT MESSAGE: ${alert.message}

COMPLIANCE REPORT:
${reportStr.substring(0, 8000)}

ORIGINAL CONTENT (ID: ${content.id}, Type: ${content.content_type}, Title: ${content.title}):
${bodyStr.substring(0, 10000)}

RULES:
- Remove or disclaim ALL earnings claims. Add: "Results vary. Past performance does not guarantee future results."
- Add opt-out/unsubscribe where missing
- Physical address: Residual Vault, LLC, Albuquerque, NM 87109
- Remove implied income promises ("turn things around", "crushing it") or add disclaimers
- Add GDPR data processing transparency where profiling language exists
- Add CCPA opt-out rights where personal data is referenced
- Replace deceptive sender identity with honest automated messaging disclosure
- Add FTC typicality disclaimers where others' results are referenced
- SMS must include STOP opt-out
- Maintain brand voice and marketing intent
- Keep same structure and format

Respond in this exact JSON:
{
  "violations": [
    {
      "severity": "critical|high|medium|low",
      "regulation": "regulation name",
      "originalText": "exact problematic text",
      "fix": "what was changed and why"
    }
  ],
  "rewrittenContent": "full rewritten content with all fixes",
  "complianceSummary": "2-3 sentence summary",
  "remainingRisks": "residual risks needing human review"
}`;

    const response = await this.chat(
      [{ role: 'user', content: userPrompt }],
      systemPrompt
    );

    return this._parseComplianceResponse(response);
  }

  _parseComplianceResponse(responseText) {
    let text = responseText;

    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fencedMatch) {
      text = fencedMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(text);
      if (!parsed.violations || !Array.isArray(parsed.violations)) {
        parsed.violations = [];
      }
      if (!parsed.rewrittenContent) {
        parsed.rewrittenContent = null;
      }
      return parsed;
    } catch (err) {
      this.log('warning', 'Failed to parse compliance response as JSON: ' + err.message);
      return {
        violations: [],
        rewrittenContent: null,
        complianceSummary: 'Auto-parse failed — raw response preserved for manual review',
        rawResponse: text.substring(0, 5000),
        remainingRisks: 'Full manual review required'
      };
    }
  }

  async _updateContent(contentId, fixResult) {
    if (!fixResult.rewrittenContent) {
      this.log('info', 'No rewritten content for ID ' + contentId + ' — skipping update');
      return;
    }

    const contentValue = typeof fixResult.rewrittenContent === 'string'
      ? JSON.stringify(fixResult.rewrittenContent)
      : JSON.stringify(fixResult.rewrittenContent);

    const metadataUpdate = JSON.stringify({
      status: 'compliance_fixed',
      compliance_fixed_at: new Date().toISOString(),
      compliance_fixed_by: 'compliance-auto-resolver',
      violations_fixed: fixResult.violations,
      compliance_summary: fixResult.complianceSummary || '',
      remaining_risks: fixResult.remainingRisks || 'None identified'
    });

    await db.query(`
      UPDATE generated_content
      SET content = $1::jsonb,
          metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
      WHERE id = $3
    `, [contentValue, metadataUpdate, contentId]);

    this.log('info', 'Updated content ' + contentId + ' with compliance-fixed version');
  }

  async _resolveAlertInDb(alertId, resolution) {
    await db.query(`
      UPDATE system_alerts
      SET resolved = true,
          details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
            'resolved_by', 'compliance-auto-resolver'::text,
            'resolved_at', $1::text,
            'resolution', $2::text
          )
      WHERE id = $3
    `, [new Date().toISOString(), resolution, alertId]);

    this.log('info', 'Resolved alert ' + alertId + ' as ' + resolution);
  }

  _buildFixSummary(fixResult, content, alert) {
    const violations = fixResult.violations || [];
    const critical = violations.filter(v => v.severity === 'critical');
    const high = violations.filter(v => v.severity === 'high');
    const medium = violations.filter(v => v.severity === 'medium');
    const low = violations.filter(v => v.severity === 'low');

    let summary = '## Compliance Auto-Fix Report\n\n';
    summary += '**Content:** ' + (content.title || 'Untitled') + ' (ID: ' + content.id + ')\n';
    summary += '**Type:** ' + content.content_type + '\n';
    summary += '**Alert Severity:** ' + alert.type + '\n';
    summary += '**Fixed:** ' + new Date().toISOString() + '\n\n';
    summary += '### Violations Fixed: ' + violations.length + '\n';
    summary += '- Critical: ' + critical.length + '\n';
    summary += '- High: ' + high.length + '\n';
    summary += '- Medium: ' + medium.length + '\n';
    summary += '- Low: ' + low.length + '\n\n';

    if (violations.length > 0) {
      summary += '### Details\n\n';
      for (const v of violations) {
        summary += '**[' + v.severity.toUpperCase() + '] ' + v.regulation + '**\n';
        summary += '- Original: "' + (v.originalText || '').substring(0, 200) + '"\n';
        summary += '- Fix: ' + v.fix + '\n\n';
      }
    }

    if (fixResult.complianceSummary) {
      summary += '### Summary\n' + fixResult.complianceSummary + '\n\n';
    }

    if (fixResult.remainingRisks) {
      summary += '### Remaining Risks (Needs Human Review)\n' + fixResult.remainingRisks + '\n';
    }

    return summary;
  }
}

module.exports = ComplianceAutoResolver;
