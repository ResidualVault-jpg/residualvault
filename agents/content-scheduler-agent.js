'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

const DAILY_CADENCE = { twitter: 3, linkedin: 0 };
const WEEKLY_CADENCE = { linkedin: 1 };  // LinkedIn: 1 post per week (Sunday)
const PLATFORM_MAP  = { 'twitter/x': 'twitter', twitter: 'twitter', x: 'twitter', linkedin: 'linkedin' };
const normPlatform  = (p) => p ? (PLATFORM_MAP[p.toLowerCase().trim()] || p.toLowerCase().trim()) : null;

function denverToday() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }));
}

class ContentSchedulerAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Content Scheduler Agent',
      role:      'You are the Content Operations Manager for ResidualVault. You plan, prioritise, and schedule all content across every channel, ensuring a consistent publishing cadence, eliminating content gaps, and optimising publish times for maximum engagement.',
      model:     'claude-sonnet-4-6',
      schedule:  '45 7 * * 0',
      timezone:  'America/Denver',
      maxTokens: 4096,
    });
  }

  /**
   * Auto-approve pending social posts and schedule them into content_posts
   * for the upcoming week (Mon–Sat). Skips posts already in content_posts.
   * This is the core automation that eliminates the manual approval bottleneck.
   */
  async autoApproveAndSchedule() {
    const now       = denverToday();
    const monday    = new Date(now);
    monday.setDate(monday.getDate() + (monday.getDay() === 0 ? 1 : 8 - monday.getDay()));
    monday.setHours(0, 0, 0, 0);
    const saturday  = new Date(monday);
    saturday.setDate(saturday.getDate() + 6);
    const mondayStr   = monday.toISOString().split('T')[0];
    const saturdayStr = saturday.toISOString().split('T')[0];

    // Count what's already scheduled this week
    const slotCounts = {};
    try {
      const existing = await db.query(
        `SELECT scheduled_date::text AS d, platform, COUNT(*)::int AS cnt
         FROM content_posts
         WHERE scheduled_date >= $1 AND scheduled_date < $2
           AND status IN ('approved', 'published')
         GROUP BY scheduled_date, platform`,
        [mondayStr, saturdayStr]
      );
      for (const r of existing.rows) slotCounts[r.d + '_' + r.platform] = r.cnt;
    } catch (_) {}

    function nextDateFor(plat) {
      const max = DAILY_CADENCE[plat] || 2;
      for (let d = 0; d < 6; d++) {
        const dt = new Date(monday);
        dt.setDate(dt.getDate() + d);
        const ds = dt.toISOString().split('T')[0];
        const key = ds + '_' + plat;
        if ((slotCounts[key] || 0) < max) {
          slotCounts[key] = (slotCounts[key] || 0) + 1;
          return ds;
        }
      }
      return mondayStr;
    }

    // Find all social-posts that are pending review (never manually approved/rejected)
    const pendingContent = await db.query(
      `SELECT * FROM generated_content
       WHERE content_type = 'social-posts'
         AND metadata->>'status' IN ('pending_review', 'approved')
         AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY created_at ASC`
    ).then(r => r.rows).catch(() => []);

    let totalScheduled = 0;
    let totalApproved  = 0;

    for (const row of pendingContent) {
      let posts = [];
      try {
        const raw = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
        posts = Array.isArray(raw) ? raw : [];
      } catch (_) { continue; }

      if (posts.length === 0) continue;

      let meta = {};
      try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); } catch (_) {}
      const defaultPlatform = normPlatform(meta.platform);

      // Auto-approve if still pending
      if (meta.status === 'pending_review') {
        await db.query(
          `UPDATE generated_content
           SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
           WHERE id = $2`,
          [JSON.stringify({ status: 'approved', autoApproved: true, approvedAt: new Date().toISOString() }), row.id]
        );
        totalApproved++;
      }

      for (const post of posts) {
        const platform = normPlatform(post.platform) || defaultPlatform;
        if (!platform) continue;
        let content = post.content || '';
        if (!content) continue;
        if (post.cta && !content.includes(post.cta)) content += '\n\n' + post.cta;
        let hashtags = '';
        if (Array.isArray(post.hashtags)) hashtags = post.hashtags.map(h => h.startsWith('#') ? h : '#' + h).join(' ');
        else if (typeof post.hashtags === 'string') hashtags = post.hashtags;

        const alreadyScheduled = await db.query(
          'SELECT 1 FROM content_posts WHERE platform = $1 AND content = $2 LIMIT 1',
          [platform, content]
        ).then(r => r.rows.length > 0).catch(() => false);
        if (alreadyScheduled) continue;

        const postDate = nextDateFor(platform);
        try {
          await db.query(
            'INSERT INTO content_posts (platform, content, hashtags, scheduled_date, scheduled_time, status) VALUES ($1,$2,$3,$4,$5,$6)',
            [platform, content, hashtags, postDate, '09:00:00', 'approved']
          );
          totalScheduled++;
        } catch (_) {}
      }
    }

    return { totalApproved, totalScheduled };
  }

  /**
   * Daily gap-fill: checks content_posts for the rest of this week.
   * If any day is missing posts (no twitter or linkedin), pulls from
   * recent approved generated_content and fills the gap.
   */
  async dailyGapFill() {
    const now     = denverToday();
    const today   = new Date(now); today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
    const todayStr   = today.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const existing = await db.query(
      `SELECT scheduled_date::text AS d, platform, COUNT(*)::int AS cnt
       FROM content_posts
       WHERE scheduled_date >= $1 AND scheduled_date < $2
         AND status IN ('approved', 'published')
       GROUP BY scheduled_date, platform`,
      [todayStr, weekEndStr]
    ).then(r => r.rows).catch(() => []);

    const slotCounts = {};
    for (const r of existing) slotCounts[r.d + '_' + r.platform] = r.cnt;

    let gapDays = [];
    for (let d = 1; d < 7; d++) {
      const dt = new Date(today); dt.setDate(dt.getDate() + d);
      if (dt.getDay() === 0) continue; // skip Sundays
      const ds = dt.toISOString().split('T')[0];
      const tw = slotCounts[ds + '_twitter']  || 0;
      const li = slotCounts[ds + '_linkedin'] || 0;
      if (tw === 0 && li === 0) gapDays.push(ds);
    }

    return gapDays;
  }

  async buildContentCalendar(daysAhead = 7) {
    const pendingContent = await db.getGeneratedContent(20);
    const today = denverToday().toISOString().split('T')[0];

    return this.ask(`
You are building a ${daysAhead}-day content publishing calendar for ResidualVault.

TODAY: ${today}
PENDING CONTENT INVENTORY: ${pendingContent.length} pieces available (types: ${[...new Set(pendingContent.map(c => c.content_type))].join(', ')})

Build a complete publishing schedule covering:
- Blog posts (3x/week)
- Social media (daily: 2 Instagram, 3 Twitter/X, 1 Facebook; weekly: 1 LinkedIn (Sunday only))
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
    const today = denverToday().toISOString().split('T')[0];
    return this.ask(`
Analyse the content schedule for ResidualVault and identify critical gaps.

Date: ${today}

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
    const mode = context.mode || 'full';

    // Fast path for daily gap-fill (no AI calls needed)
    if (mode === 'gap-fill') {
      this._log('info', 'Running daily gap-fill check');
      const { totalApproved, totalScheduled } = await this.autoApproveAndSchedule();
      const gapDays = await this.dailyGapFill();
      this._log('info', `Gap-fill: approved ${totalApproved}, scheduled ${totalScheduled}, gap days remaining: ${gapDays.length}`);
      if (gapDays.length > 0) {
        await this.reportIssue('medium', `${gapDays.length} days with no scheduled content`, `Dates: ${gapDays.join(', ')}`);
      }
      return { mode: 'gap-fill', totalApproved, totalScheduled, gapDays };
    }

    // Full Sunday run: auto-approve + schedule + AI calendar + gap analysis
    this._log('info', 'Running full weekly content scheduling');

    const { totalApproved, totalScheduled } = await this.autoApproveAndSchedule();
    this._log('info', `Auto-approved ${totalApproved} batches, scheduled ${totalScheduled} posts into content_posts`);

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

    const totalSlots = (calendar.totalSlots || 0) + totalScheduled;

    await this.saveContent(
      'content-calendar',
      `7-Day Content Calendar — ${totalSlots} slots`,
      JSON.stringify(calendar.schedule || [], null, 2),
      null,
      { totalSlots, contentNeeds: calendar.contentNeeds, autoApproved: totalApproved, autoScheduled: totalScheduled }
    );

    await this.saveReport(
      'content-schedule',
      `Weekly Content Schedule — Health: ${gaps.overallHealth || 'N/A'}, Slots: ${totalSlots}, Auto-scheduled: ${totalScheduled}`,
      JSON.stringify({ calendar, gaps, autoApproved: totalApproved, autoScheduled: totalScheduled }, null, 2),
      gaps.overallHealth === 'red' ? 'high' : 'normal'
    );

    return {
      scheduledSlots: totalSlots,
      autoApproved:  totalApproved,
      autoScheduled: totalScheduled,
      contentNeeds:  (calendar.contentNeeds || []).length,
      criticalGaps:  (gaps.criticalGaps || []).filter(g => g.urgency === 'high').length,
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
