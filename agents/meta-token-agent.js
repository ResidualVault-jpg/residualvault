'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const axios     = require('axios');
const fs        = require('fs');
const path      = require('path');

const ENV_PATH    = path.join(__dirname, '../.env');
const GRAPH_API   = 'https://graph.facebook.com/v21.0';
const APP_ID      = process.env.META_APP_ID;
const APP_SECRET  = process.env.META_APP_SECRET;
const PAGE_ID     = process.env.META_PAGE_ID;

class MetaTokenAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Meta Token Agent',
      role:      'You monitor and refresh Meta/Facebook/Instagram API tokens to ensure uninterrupted publishing capabilities.',
      model:     'claude-sonnet-4-6',
      schedule:  '0 5 * * *',
      timezone:  'America/Denver',
      maxTokens: 1024,
    });
  }

  async checkToken(token) {
    const res = await axios.get(`${GRAPH_API}/debug_token`, {
      params: {
        input_token: token,
        access_token: `${APP_ID}|${APP_SECRET}`,
      },
    });
    return res.data.data;
  }

  async exchangeForLongLived(token) {
    const res = await axios.get(`${GRAPH_API}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: token,
      },
    });
    return res.data;
  }

  async getPageToken(userToken) {
    const res = await axios.get(`${GRAPH_API}/${PAGE_ID}`, {
      params: {
        fields: 'access_token,instagram_business_account',
        access_token: userToken,
      },
    });
    return res.data;
  }

  updateEnvVar(key, value) {
    let env = fs.readFileSync(ENV_PATH, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(env)) {
      env = env.replace(regex, `${key}=${value}`);
    } else {
      env += `\n${key}=${value}`;
    }
    fs.writeFileSync(ENV_PATH, env);
    process.env[key] = value;
  }

  async execute() {
    const userToken = process.env.META_USER_TOKEN;
    if (!userToken) {
      await this.reportIssue('high', 'Meta Token Missing', 'META_USER_TOKEN is not set in .env');
      return { status: 'error', reason: 'no_token' };
    }

    this._log('info', 'Checking Meta user token validity');
    let tokenInfo;
    try {
      tokenInfo = await this.checkToken(userToken);
    } catch (err) {
      await this.reportIssue('high', 'Meta Token Check Failed', err.message);
      return { status: 'error', reason: err.message };
    }

    if (!tokenInfo.is_valid) {
      await this.reportIssue('critical', 'Meta Token Expired',
        'META_USER_TOKEN has expired. Owner must re-authenticate at developers.facebook.com and provide a new short-lived token.');
      return { status: 'expired', scopes: tokenInfo.scopes };
    }

    const expiresAt = tokenInfo.expires_at;
    const now = Math.floor(Date.now() / 1000);
    const daysLeft = Math.floor((expiresAt - now) / 86400);
    this._log('info', `Token valid. Expires in ${daysLeft} days. Scopes: ${(tokenInfo.scopes || []).join(', ')}`);

    const scopes = tokenInfo.scopes || [];
    const hasInstagramPublish = scopes.includes('instagram_content_publish');
    const hasInstagramBasic   = scopes.includes('instagram_basic');
    const hasPagesManage      = scopes.includes('pages_manage_posts');

    if (!hasInstagramPublish || !hasInstagramBasic) {
      this._log('warning', 'Missing Instagram permissions — instagram_content_publish and/or instagram_basic not yet approved by Meta');
    }

    // Refresh if within 14 days of expiration
    if (daysLeft <= 14) {
      this._log('info', `Token expires in ${daysLeft} days — refreshing`);
      try {
        const refreshed = await this.exchangeForLongLived(userToken);
        const newToken = refreshed.access_token;
        const newExpiry = Math.floor(refreshed.expires_in / 86400);

        this.updateEnvVar('META_USER_TOKEN', newToken);
        this._log('info', `User token refreshed. New expiry: ${newExpiry} days`);

        // If we have page permissions, derive page token
        if (hasPagesManage) {
          try {
            const pageData = await this.getPageToken(newToken);
            if (pageData.access_token) {
              this.updateEnvVar('META_PAGE_ACCESS_TOKEN', pageData.access_token);
              this._log('info', 'Page access token refreshed (non-expiring)');
            }
            if (pageData.instagram_business_account) {
              this.updateEnvVar('INSTAGRAM_BUSINESS_ACCOUNT_ID', pageData.instagram_business_account.id);
              this._log('info', `Instagram Business Account ID: ${pageData.instagram_business_account.id}`);
            }
          } catch (pageErr) {
            this._log('warning', `Could not derive page token: ${pageErr.message}`);
          }
        }

        await this.saveReport('token-refresh', `Meta token refreshed — ${newExpiry} days remaining`, JSON.stringify({
          daysRemaining: newExpiry,
          scopes,
          hasInstagramPublish,
          hasInstagramBasic,
          hasPagesManage,
        }));

        return { status: 'refreshed', daysRemaining: newExpiry, scopes };
      } catch (err) {
        await this.reportIssue('critical', 'Meta Token Refresh Failed',
          `Could not refresh token (${daysLeft} days remaining): ${err.message}. Owner must re-authenticate manually.`);
        return { status: 'refresh_failed', daysLeft, error: err.message };
      }
    }

    // Token is healthy — log status
    await this.saveReport('token-status', `Meta token healthy — ${daysLeft} days remaining`, JSON.stringify({
      daysRemaining: daysLeft,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      scopes,
      hasInstagramPublish,
      hasInstagramBasic,
      hasPagesManage,
      publishReady: hasInstagramPublish && hasInstagramBasic && hasPagesManage,
    }));

    if (daysLeft <= 30) {
      await this.reportIssue('medium', `Meta Token Expiring in ${daysLeft} Days`,
        'Token will be auto-refreshed at 14 days, but flagging early for awareness.');
    }

    return { status: 'healthy', daysRemaining: daysLeft, scopes, publishReady: hasInstagramPublish && hasInstagramBasic && hasPagesManage };
  }
}

module.exports = MetaTokenAgent;

if (require.main === module) {
  const agent = new MetaTokenAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
