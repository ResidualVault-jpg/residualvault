# ResidualVault — System Reference

## Platform
ResidualVault (residualvault.com) — cryptocurrency staking comparison and intelligence platform. Tracks 156+ staking protocols with live APY data, risk analysis, and yield comparisons. Subscription tiers: Free, Starter ($3.69/mo), Pro ($9.99/mo), Premium ($19.99/mo) via Stripe.

## Infrastructure
- Server: DigitalOcean droplet at 64.23.240.10
- OS: Ubuntu 24.04
- User: root (SSH), vaultadmin (app owner — has its own PM2 instance)
- SSH: ssh -i ~/.ssh/id_ed25519 root@64.23.240.10
- Stack: Node.js + Express + PostgreSQL + PM2 + Nginx + React SPA
- Project: /home/vaultadmin/residualvault/
- Frontend source: /home/vaultadmin/rv-original/residualvault-platform-final/frontend/src/
- Database: postgresql://vaultuser:RVSecure2026@localhost:5432/residualvault
- GitHub: https://github.com/ResidualVault-jpg/residualvault.git (branch: claude/build-ai-agent-system-e0Lfr)
- Email: SendGrid (Essentials plan $20/mo) — domain authenticated, link branding verified
- Payments: Stripe (live keys in .env)

## PM2 Processes

PM2 runs under the `vaultadmin` user. Use `sudo -u vaultadmin bash -c 'pm2 ...'` from root.

| Process | File | Port | Purpose |
|---------|------|------|---------|
| rv-api | index.js | 3000 | Main API + SSR pre-rendering + static site + auth + payments |
| rv-scheduler | scheduler.js | — | All 34 agents + publishers + APY alert checker on cron |
| rv-control | dashboard/rv-control.js | 3001 | Approval dashboard + agent command center |

## Dashboards
- residualvault.com/rv-control — Sunday content review queue, approve/reject
- residualvault.com/agent-control — Agent status, logs, metrics, manual triggers

---

## Email Pipeline

Fixed May 2026. Previously zero emails were ever sent despite having subscribers.

- **SendGrid Essentials** ($20/mo) — upgraded from free tier which was blocked
- **Domain Authentication**: em9719.residualvault.com (CNAME verified via Cloudflare)
- **Link Branding**: url1791.residualvault.com (CNAME verified via Cloudflare)
- **Single Senders Verified**: support@residualvault.com, mochtarmusic@gmail.com
- **Welcome Email**: auth.js sends branded HTML welcome email on registration via SendGrid
- **Newsletter Pipeline**: Email Conductor agent generates → rv-control review → emailPublisher.js sends Mondays 8 AM Denver
- **APY Alert Emails**: apyAlertChecker.js sends branded alert emails when user thresholds are crossed (every 30 min cron)
- **Logo**: rv-shield.png served from /images/rv-shield.png, used in all email headers

### Key Email Files
- `/home/vaultadmin/residualvault/auth.js` — Registration + welcome email + auto newsletter subscribe
- `/home/vaultadmin/residualvault/emailPublisher.js` — Newsletter publishing (Mondays 8 AM)
- `/home/vaultadmin/residualvault/apyAlertChecker.js` — APY alert checker + email sender (every 30 min)

---

## Conversion Optimization System

Implemented May 2026 to convert 142K monthly pageviews into paid subscribers.

### Backend Auth Middleware (index.js)
- `optionalAuth(req, res, next)` — attaches req.user if valid Bearer token present, continues either way
- `requireAuth(req, res, next)` — blocks with 401 + `{upgrade: true}` if no valid token

### Gated API Endpoints (index.js)
- `GET /api/protocols/:slug/detail` (optionalAuth) — gated protocol data:
  - Non-auth: null for high/low/avg APY, only 3 history entries, `gated: true`
  - Free: 12 history entries, full stats
  - Paid: 48 history entries, full stats
- `GET /api/plan/limits` (optionalAuth) — returns plan capabilities for frontend UI gating
- `POST /api/alerts` (requireAuth) — creates APY alert, free plan limit: 1 active alert
- `GET /api/alerts` (requireAuth) — lists user's active alerts
- `DELETE /api/alerts/:id` (requireAuth) — soft-deletes alert

### Frontend Gating

**Comparison Tool** (CompareContext.tsx + CompareModal.tsx):
- Non-auth: max 2 protocols, comparison table shows only APY + Category (rest blurred with sign-up CTA)
- Free: max 3 protocols, full comparison data
- Starter+: max 5 protocols, full access

**Calculator** (CalculatorLandingPage.tsx):
- Non-auth: 1 protocol, portfolio total blurred, 3yr/5yr/10yr locked, no side-by-side table
- Free: 2 protocols, all data visible, up to 5yr
- Starter+: 5 protocols, all time periods, full access

**Protocol Pages** (ProtocolPage.tsx):
- Non-auth: stats blurred with lock icons, 3 history entries, sign-up CTAs
- Free: full stats, 12 history entries, 1 APY alert, upgrade CTAs for more
- Paid: 48 history entries, unlimited alerts

**Staking Page** (StakingPage.tsx):
- Non-auth: sign-up banner at top, conversion CTA card after first page of results
- Authenticated: clean experience

### Plan Limits (from /api/plan/limits)
| Feature | Non-Auth | Free | Starter | Pro | Premium |
|---------|----------|------|---------|-----|---------|
| Comparisons | 2 | 3 | Unlimited | Unlimited | Unlimited |
| Alerts | 0 | 1 | Unlimited | Unlimited | Unlimited |
| History Depth | 3 | 12 | 48 | 48 | 48 |
| Risk Analysis | No | No | No | Yes | Yes |
| Tax Reporting | No | No | No | Yes | Yes |
| API Access | No | No | No | No | Yes |

### APY Alert Checker (apyAlertChecker.js)
- Runs every 30 minutes via scheduler.js
- Checks all active alerts in user_apy_alerts against current APY from vault_rewards
- Sends branded HTML email via SendGrid when threshold is crossed (below/above)
- 6-hour cooldown per alert to prevent spam
- Updates last_triggered timestamp after firing

---

## SEO and Dynamic Rendering

React SPA with dynamic rendering for search engine bots. Implemented April 2026.

### How It Works
- **seo-prerender.js** — Express middleware that intercepts requests for SEO-critical pages
- Detects bot user-agents (Googlebot, Bingbot, Google-InspectionTool, etc.)
- **Bots:** Strips all `<script>` and `<link rel="modulepreload">` tags — serves pure HTML with pre-rendered content (protocol data from PostgreSQL). React never mounts, no API calls needed.
- **Regular users:** Keeps all scripts — full React SPA experience as normal.
- Body content injected into `<div id="root">` with dynamic data from database (protocol APY, categories, related protocols).

### Pages Handled by SSR
All proxied through Nginx → Express (localhost:3000):
- `/` (homepage), `/staking`, `/leaderboard`, `/calculator`
- `/pricing`, `/about`, `/education`, `/blog`
- `/blog/*` (6 blog articles with full content)
- `/protocol/*` (all 156 protocol pages with live APY from database)

### Key Files
- `/home/vaultadmin/residualvault/seo-prerender.js` — Dynamic rendering middleware
- `/etc/nginx/sites-enabled/residualvault` — Nginx config with SEO proxy routes
- `/home/vaultadmin/rv-original/residualvault-platform-final/frontend/dist/robots.txt` — Crawl rules
- `/home/vaultadmin/rv-original/residualvault-platform-final/frontend/dist/index.html` — SPA entry (re-patch after every `npm run build`)

### Google Search Console
- Sitemap submitted: residualvault.com/sitemap.xml (173 discovered pages)
- All key pages passing live test and indexing requested (April 29, 2026)

### Important: After Frontend Builds
Every `npm run build` overwrites dist/index.html and removes robots.txt. After building:
1. Re-create robots.txt in dist/ (saved backup at /tmp/robots.txt.save)
2. rsync dist/ to /home/vaultadmin/residualvault/public/
3. Restart rv-api: `sudo -u vaultadmin bash -c 'pm2 restart rv-api'`

---

## Architecture: Full In-House System

Everything is built in-house. No Make.com. No Canva API. No Airtable. No Buffer. No third-party automation platforms.

- AI Models: Anthropic Claude (Opus 4.6 for decision/strategy agents, Sonnet 4.6 for content/scanning agents)
- Database: PostgreSQL — agent_logs, agent_metrics, agent_reports, generated_content, content_posts, system_alerts, user_apy_alerts, newsletter_subscribers
- Scheduling: node-cron in scheduler.js
- Logging: Winston with file rotation (logs/ directory)
- Publishing: socialPublisher.js (Twitter + LinkedIn), youtubePublisher.js (YouTube), emailPublisher.js (SendGrid newsletters)
- Base Classes: agents/base-agent.js (main agents), agents/base-sub-agent.js (sub-agents)

---

## 34-Agent System

All agents live in /home/vaultadmin/residualvault/agents/ and are registered in scheduler.js.

### Sunday Batch — Weekly Content Generation
Runs every Sunday, staggered from 6:00 AM to 3:00 PM Denver (Mountain) time.
Auto-scheduler triggers at 12:00 PM (noon) Denver on Sundays.
Owner reviews content at rv-control on Sundays before approving.

| Time | Agent | Model | Key |
|------|-------|-------|-----|
| 6:00 AM | Analytics Oracle | opus | analytics-oracle |
| 6:15 AM | Intelligence Scout | opus | intelligence-scout |
| 6:30 AM | Industry Researcher | opus | industry-researcher |
| 6:45 AM | Revenue Intelligence Agent | opus | revenue-intelligence |
| 7:00 AM | SEO Architect | opus | seo-architect |
| 7:00 AM | Twitter Content Creator | sonnet | twitter-content |
| 7:15 AM | Brand Voice Auditor | sonnet | brand-voice |
| 7:15 AM | LinkedIn Content Creator | sonnet | linkedin-content |
| 7:30 AM | Content Commander | opus | content-commander |
| 7:45 AM | Content Scheduler Agent | sonnet | content-scheduler |
| 7:45 AM | Social Media Agent | sonnet | social-media |
| 8:00 AM | Community Voice | sonnet | community-voice |
| 8:30 AM | Email Conductor | sonnet | email-conductor |
| 8:45 AM | Marketing Master Agent | opus | marketing-master |
| 9:00 AM | Advertising Master Agent | opus | advertising-master |
| 9:15 AM | Ad Strategist | opus | ad-strategist |
| 9:30 AM | Promotions Master Agent | sonnet | promotions-master |
| 9:45 AM | Partnership Scout | opus | partnership-scout |
| 10:00 AM | Personalization Engine | opus | personalization |
| 10:15 AM | Customer Success Agent | sonnet | customer-success |
| 10:30 AM | Legal and Compliance Guardian | opus | legal-compliance |
| 10:45 AM | Compliance Auto-Resolver | opus | compliance-auto-resolver |
| 10:45 AM | Graphics/Image Agent | sonnet | graphics-image |
| 11:00 AM | Master Strategist | opus | master-strategist |
| 11:15 AM | Cybersecurity Agent | opus | cybersecurity |
| 11:30 AM | Infrastructure Security Scanner | sonnet | infra-security |
| 11:45 AM | Threat Intelligence Agent | sonnet | threat-intel |
| 3:00 PM | Veo Video Agent | sonnet | veo-video |

### Daily Agents

| Schedule | Agent | Model | Key |
|----------|-------|-------|-----|
| Every 15 min | Crisis Response Agent | sonnet | crisis-response |
| Daily 6:00 AM | User Testing Agent | sonnet | user-testing |
| Daily 6:30 AM | Fixer Agent | sonnet | fixer |
| Daily 5:00 AM | Meta Token Agent | sonnet | meta-token |
| Daily 5:00 AM | Instagram Carousel Agent | sonnet | instagram-carousel |
| Daily | Staking Alpha Agent | sonnet | staking-alpha |

### Scheduled Jobs (not agents)

| Schedule | Job | Description |
|----------|-----|-------------|
| 9:00 AM Denver daily | socialPublisher.js | Twitter/X + LinkedIn publishing |
| 10:00 AM Denver daily | youtubePublisher.js | YouTube publishing |
| 8:00 AM Denver Mondays | emailPublisher.js | Newsletter sending via SendGrid |
| Every 30 min | apyAlertChecker.js | APY alert threshold checker + email sender |
| 12:00 PM Denver Sundays | Auto-scheduler | Content auto-approve and schedule |
| 7:00 AM Denver Mon-Sat | Gap-fill | Auto-approve missed content |

---

## Agent Roles

### Research and Intelligence
- **Industry Researcher** — Scans crypto, tech, finance news daily. Feeds intelligence to all other agents.
- **Intelligence Scout** — Competitor monitoring + trend identification. Weekly briefing.
- **Partnership Scout** — Identifies partnership opportunities in crypto/DeFi space.

### Content Creation
- **Content Commander** — Generates all social media content for the week (168+ posts across platforms).
- **Social Media Agent** — Platform-specific post optimization and formatting.
- **Twitter Content Creator** — Sub-agent: Twitter/X posts, threads, polls.
- **LinkedIn Content Creator** — Sub-agent: LinkedIn professional content.
- **SEO Architect** — Blog posts, keyword strategy, SEO reports.
- **Email Conductor** — Email sequences, newsletters, nurture campaigns via SendGrid.
- **Graphics/Image Agent** — Branded image generation for posts and campaigns.
- **Instagram Carousel Agent** — Instagram carousel content generation.
- **Content Scheduler Agent** — 7-day content calendar, gap analysis, publishing cadence.
- **Brand Voice Auditor** — Checks all content for tone/voice consistency.

### Video Production
- **Veo Video Agent** — Cinematic marketing videos using Veo 3.1. Scripts, generates clips, coordinates post-production.

### Advertising and Revenue
- **Ad Strategist** — Paid ad copy and campaign management.
- **Advertising Master Agent** — Cross-channel ad coordination and budget optimization.
- **Promotions Master Agent** — Promotional campaigns and offers.
- **Revenue Intelligence Agent** — Revenue tracking, conversion analysis, pricing optimization.

### Analytics and Strategy
- **Analytics Oracle** — Site + social performance analytics. Daily reports.
- **Master Strategist** — Cross-agent strategy synthesis. Sunday briefing.
- **Marketing Master Agent** — Marketing coordination across all channels.
- **Personalization Engine** — User experience personalization based on behavior data.
- **Staking Alpha Agent** — Staking market alpha intelligence and opportunity detection.

### Community and Customer
- **Community Voice** — Social media engagement, community replies, relationship building.
- **Customer Success Agent** — Customer support, retention, onboarding flows.

### Security and Compliance
- **Cybersecurity Agent** — Application security scanning, vulnerability detection.
- **Infrastructure Security Scanner** — Server and infrastructure security audits.
- **Threat Intelligence Agent** — External threat monitoring and alerts.
- **Legal and Compliance Guardian** — Regulatory compliance checks for crypto/finance content.
- **Compliance Auto-Resolver** — Runs 15 min after Legal Guardian. Auto-fixes flagged compliance violations: rewrites content, adds disclaimers, resolves alerts. Uses Claude Opus. Deployed 2026-05-03.

### Operations
- **Crisis Response Agent** — Runs every 15 minutes. Incident detection and auto-response.
- **Fixer Agent** — Runs daily. Auto-fixes detected issues from other agents.
- **User Testing Agent** — UX testing scenarios and usability checks.
- **Meta Token Agent** — Meta/Facebook token management and refresh.

---

## Social Media Status

| Platform | Status | How | Links |
|----------|--------|-----|-------|
| Twitter/X | LIVE | socialPublisher.js via Twitter API v2 | x.com/ResidualVault |
| LinkedIn | LIVE | socialPublisher.js via LinkedIn UGC API | linkedin.com/company/residual-vault |
| YouTube | LIVE | youtubePublisher.js via YouTube Data API v3 | |
| TikTok | PENDING | API review submitted. Credentials in .env. Publisher not built yet. | |
| Instagram | PENDING | Meta app review submitted. Credentials in .env. Publisher not built yet. | |
| Facebook | PENDING | Same Meta app as Instagram. Same token issue. | |

### Meta App (Facebook + Instagram)
- App name: Residual Vault Automation
- App ID: 779634615214522
- Facebook Page ID: 61587437024840
- Instagram App ID: 905354658863483
- Current permissions: pages_show_list, pages_read_engagement
- MISSING permissions (need Meta approval): instagram_content_publish, instagram_basic
- Page Access Token: EXPIRED (March 6, 2026) — must regenerate at developers.facebook.com

### TikTok App
- Client Key in .env (TIKTOK_CLIENT_KEY)
- Status: API review submitted, awaiting approval

---

## Video and Graphics Production

### Artlist.io (Primary — Paid Subscription)
Used for ALL video and graphics work:
- Veo 3.1 — AI video generation with lip-synced dialogue, character casting
- Nano Banana 2 — Image generation for carousel slides and graphics
- Artlist Studio — Shot-by-shot directorial control, casting, character consistency
- Music Library — Licensed music and SFX for video projects
- Workflow: Generate clips in Artlist Studio, download, compose in Remotion, render final

### Remotion (Local Composition)
React video framework for post-production. Local project at: ~/Desktop/Residual Vault, LLC/rv-promo-video/
- Crossfade transitions, logo bookends, color grading, music mixing
- Preview: npm run preview | Render: npm run render
- Published videos stored in: ~/Desktop/Residual Vault, LLC/Residual Vault Videos/

### Retired: HeyGen
heygen-video-agent.js exists on server but is NOT in the scheduler. Fully replaced by Veo Video Agent using Artlist. Do not use. Can be deleted.

---

## Content Pipeline

RESEARCH (Daily/Weekly)
Industry Researcher + Intelligence Scout + Partnership Scout scan markets and competitors

GENERATE (Sunday batch — all agents report by noon Denver)
Content Commander + sub-agents create week's content
SEO Architect creates blog posts
Email Conductor creates newsletters
Graphics/Image Agent creates branded images
Veo Video Agent creates marketing videos

REVIEW (Sunday afternoon — owner reviews at rv-control)
All content saved to generated_content table with status pending_review
Owner reviews at residualvault.com/rv-control
Approve or Reject each piece

PUBLISH (Daily automated)
socialPublisher.js publishes to Twitter + LinkedIn at 9 AM Denver
youtubePublisher.js publishes to YouTube at 10 AM Denver
emailPublisher.js publishes approved newsletters Mondays at 8 AM Denver
Instagram, TikTok, Facebook — pending API approval

ANALYZE (Ongoing)
Analytics Oracle tracks performance
Master Strategist synthesizes nightly action plan
Fixer Agent auto-remediates issues

---

## Database Tables

- agent_logs — Activity logs from all agents (agent_name, status, message, data)
- agent_reports — Structured reports (agent_name, report JSON)
- agent_metrics — Per-agent metrics (runs total, success/fail counts, duration, last run)
- generated_content — All AI content (agent_name, content_type, title, content, url, metadata with review status)
- content_posts — Scheduled posts (platform, content, status, scheduled_date, hashtags)
- system_alerts — Unresolved alerts (agent_name, type/severity, message, resolved flag)
- users — User accounts (id, email, password_hash, plan, first_name, last_name, created_at, last_login)
- protocols — 156+ staking protocols with metadata
- vault_rewards — Live APY data per protocol (apy, tvl, token, fetched_at)
- user_apy_alerts — User APY alert subscriptions (user_id, protocol_id, direction, threshold, is_active, last_triggered)
- newsletter_subscribers — Email newsletter subscribers (auto-populated on registration)
- email_sends — Record of sent emails

---

## Credentials (.env)

All API keys and secrets in /home/vaultadmin/residualvault/.env — NEVER commit to git.

| Variable | Service |
|----------|---------|
| ANTHROPIC_API_KEY | Claude AI (all agents) |
| OPENAI_API_KEY | OpenAI (graphics agent) |
| GEMINI_API_KEY | Veo 3.1 video (server-side fallback) |
| TWITTER_API_KEY + TWITTER_API_SECRET | Twitter/X app |
| TWITTER_ACCESS_TOKEN + TWITTER_ACCESS_SECRET | Twitter/X publishing |
| LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET | LinkedIn app |
| LINKEDIN_ACCESS_TOKEN | LinkedIn publishing |
| YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET | YouTube app |
| YOUTUBE_ACCESS_TOKEN + YOUTUBE_REFRESH_TOKEN | YouTube publishing |
| META_APP_ID + META_APP_SECRET | Facebook/Instagram app |
| META_PAGE_ACCESS_TOKEN | Facebook Page publishing (EXPIRED) |
| META_PAGE_ID + META_USER_ID | Facebook Page identifiers |
| INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET | Instagram app |
| TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET | TikTok app |
| SENDGRID_API_KEY | Email delivery (SendGrid Essentials) |
| STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY | Payments |
| STRIPE price IDs | Starter/Pro/Premium monthly + yearly |
| DATABASE_URL | PostgreSQL connection |
| JWT_SECRET + ADMIN_PASSWORD | Auth |

---

## Stripe Price IDs

| Tier | Monthly Price ID | Annual Price ID |
|------|-----------------|-----------------|
| Starter ($3.69/mo) | price_1TFRKaGl2IumEk3qIBbhzcL8 | price_1TFROTGl2IumEk3qti4FLSZH |
| Pro ($9.99/mo) | price_1TFRLWGl2IumEk3qgFLUxB6r | price_1TFRQvGl2IumEk3qwvsR6omw |
| Premium ($19.99/mo) | price_1TFRM2Gl2IumEk3q98xs6sYi | price_1TFRS5Gl2IumEk3qQDyYqVr3 |

---

## Quick Commands

```bash
# SSH to server
ssh -i ~/.ssh/id_ed25519 root@64.23.240.10

# PM2 (always run as vaultadmin — root PM2 is separate)
sudo -u vaultadmin bash -c 'pm2 list'
sudo -u vaultadmin bash -c 'pm2 logs rv-scheduler --lines 50'
sudo -u vaultadmin bash -c 'pm2 restart rv-scheduler'
sudo -u vaultadmin bash -c 'pm2 restart rv-api'

# Trigger an agent manually
sudo -u vaultadmin bash -c 'cd /home/vaultadmin/residualvault && node -e "require(\"./scheduler\").runAgent(\"content-commander\")"'

# Run APY alert checker manually
cd /home/vaultadmin/residualvault && node -e "require('dotenv').config(); require('./apyAlertChecker')().then(r => console.log(r))"

# Build frontend (from source)
cd /home/vaultadmin/rv-original/residualvault-platform-final/frontend && npm run build

# Deploy frontend after build
cp /tmp/robots.txt.save dist/robots.txt
rsync -a dist/ /home/vaultadmin/residualvault/public/
sudo -u vaultadmin bash -c 'pm2 restart rv-api'

# Database access
psql postgresql://vaultuser:RVSecure2026@localhost:5432/residualvault

# Check agent metrics
# SELECT agent_name, metrics FROM agent_metrics ORDER BY updated_at DESC;

# View review queue
# SELECT id, agent_name, content_type, title FROM generated_content WHERE metadata->>'status' = 'pending_review' ORDER BY created_at DESC LIMIT 20;

# Check published posts
# SELECT id, platform, status, scheduled_date FROM content_posts WHERE status = 'published' ORDER BY updated_at DESC LIMIT 10;

# Check APY alerts
# SELECT ua.*, u.email, p.name FROM user_apy_alerts ua JOIN users u ON u.id = ua.user_id JOIN protocols p ON p.id = ua.protocol_id WHERE ua.is_active = true;
```

---

## Frontend Source Files (Modified)

Frontend source: `/home/vaultadmin/rv-original/residualvault-platform-final/frontend/src/`

| File | Changes |
|------|---------|
| pages/HomePage.tsx | Removed fake social proof, rewrote features and CTA to match actual product |
| pages/PricingPage.tsx | 4 tiers with Stripe checkout integration, annual/monthly toggle |
| pages/AboutPage.tsx | Complete rewrite: founder info, Albuquerque NM, LLC, 34-agent system |
| pages/StakingPage.tsx | Sign-up banner for non-auth, conversion CTA card after first page |
| pages/ProtocolPage.tsx | Full gating: blurred stats for non-auth, APY alerts UI, upgrade CTAs |
| pages/CalculatorLandingPage.tsx | Gated: 1 protocol non-auth, 2 free, 5 paid; locked time periods |
| components/CompareModal.tsx | Gated: APY+Category visible, rest blurred for non-auth, sign-up CTA |
| context/CompareContext.tsx | Auth-aware maxCompare: 2 non-auth, 3 free, 5 paid |
| components/layout/Footer.tsx | Real social links (X, LinkedIn, support email) |
| store/authStore.ts | Zustand + persist, user/token/isAuthenticated |

---

## Pending Work

1. Instagram/Facebook publisher — Build once Meta approves instagram_content_publish permission. Refresh expired Page Access Token first.
2. TikTok publisher — Build once TikTok API approved.
3. Instagram carousel image generation — Wire Graphics/Image Agent to use Artlist Nano Banana 2 for multi-slide carousel images.
4. Partnership outreach automation pipeline — Partnership Scout generates leads but outreach is not automated.
5. Remove heygen-video-agent.js — Dead code, replaced by Veo Video Agent.
6. Monitor Google Search Console — Confirm pages move from "Discovered" to "Indexed" (submitted April 29, 2026).
7. Education hub gating — Gate premium educational content behind sign-up/subscription.
8. Social proof — Add "Tracking $X billion in staked assets" counter instead of user counts.

---

## Owner

- **Name:** Mochtar Abukusumo
- **Location:** Albuquerque, New Mexico
- **Company:** Residual Vault, LLC
- **Contact:** support@residualvault.com

## Owner Preferences

- Act as rigorous honest mentor — identify weaknesses and blind spots
- Do not default to agreement — be direct and clear
- Prioritize helping improve over being agreeable
- All systems built in-house — no third-party automation platforms
- Use Artlist.io + Remotion for all video/graphics — never use Gemini API for media generation directly
- All data must use real sources and real physics — never Math.random() for measurements
- Deliver documents as PDF, not .docx
- DigitalOcean service name is 'ssh' not 'sshd'
