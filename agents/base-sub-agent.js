'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class BaseSubAgent extends BaseAgent {
  /**
   * @param {object} config
   * @param {string} config.name          - Sub-agent display name
   * @param {string} config.role          - Role description
   * @param {string} config.departmentHead - Name of the department head agent
   * @param {string} [config.model]       - Claude model (defaults to sonnet)
   * @param {string} [config.schedule]    - Cron schedule
   * @param {string} [config.timezone]    - IANA timezone
   * @param {number} [config.maxTokens]   - Max tokens per call
   */
  constructor(config) {
    super({
      ...config,
      model: config.model || 'claude-sonnet-4-6',
    });
    this.departmentHead = config.departmentHead;
    if (!this.departmentHead) {
      throw new Error(`Sub-agent "${this.name}" must specify a departmentHead`);
    }
  }

  /**
   * Override saveContent to route work to department head review queue
   * instead of directly to the CEO review queue.
   */
  /**
   * Check for revision feedback from department head.
   * Returns array of items that need revision with feedback.
   */
  async getRevisionFeedback() {
    const db = require('../db');
    const result = await db.query(
      "SELECT id, title, content, metadata FROM generated_content WHERE metadata->>'sub_agent' = $1 AND metadata->>'status' = $2 ORDER BY created_at DESC LIMIT 5",
      [this.name, 'revision_needed']
    );
    const items = result.rows.map(function(row) {
      var meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      return {
        id: row.id,
        title: row.title,
        feedback: meta.dept_review ? meta.dept_review.feedback : null,
        edits: meta.dept_review ? meta.dept_review.edits : null,
        score: meta.dept_review ? meta.dept_review.score : null,
      };
    });
    return items.filter(function(i) { return i.feedback; });
  }

  /**
   * Mark a revision_needed item as resubmitted after incorporating feedback.
   */
  async markRevisionResubmitted(itemId) {
    const db = require('../db');
    const result = await db.query('SELECT metadata FROM generated_content WHERE id = $1', [itemId]);
    if (result.rows.length > 0) {
      var meta = typeof result.rows[0].metadata === 'string' ? JSON.parse(result.rows[0].metadata) : (result.rows[0].metadata || {});
      meta.status = 'revision_resubmitted';
      meta.resubmittedAt = new Date().toISOString();
      await db.query('UPDATE generated_content SET metadata = $1 WHERE id = $2', [JSON.stringify(meta), itemId]);
    }
  }

  /**
   * Build a feedback context string for the AI prompt.
   */
  async buildFeedbackContext() {
    var revisions = await this.getRevisionFeedback();
    if (revisions.length === 0) return '';
    var context = '\nIMPORTANT - Your department head sent back previous work with this feedback. Incorporate these corrections:\n';
    for (var i = 0; i < revisions.length; i++) {
      var r = revisions[i];
      context += '- "' + r.title + '" (score: ' + r.score + '): ' + r.feedback + '\n';
    }
    // Mark old revisions as resubmitted
    for (var j = 0; j < revisions.length; j++) {
      await this.markRevisionResubmitted(revisions[j].id);
    }
    return context;
  }

  async saveContent(contentType, title, content, url = null, metadata = null) {
    const meta = (metadata && typeof metadata === 'object') ? { ...metadata } : {};
    meta.status = 'awaiting_dept_review';
    meta.department_head = this.departmentHead;
    meta.sub_agent = this.name;
    meta.submitted_at = new Date().toISOString();
    // Parse content if it's a JSON string so it saves properly
    let contentToSave = content;
    try { contentToSave = JSON.parse(content); } catch(_) { contentToSave = content; }
    const db = require('../db');
    await db.saveGeneratedContent(this.name, contentType, title, contentToSave, url, meta);
  }
}

module.exports = BaseSubAgent;
