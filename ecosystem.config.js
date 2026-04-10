'use strict';

const DEPLOY_DIR = '/home/vaultadmin/residualvault';

module.exports = {
  apps: [
    {
      name: 'rv-scheduler',
      script: `${DEPLOY_DIR}/scheduler.js`,
      cwd: DEPLOY_DIR,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV:   'production',
        DEPLOY_DIR,
        HTTPS_PROXY:              process.env.GLOBAL_AGENT_HTTP_PROXY || process.env.HTTPS_PROXY || '',
        HTTP_PROXY:               process.env.GLOBAL_AGENT_HTTP_PROXY || process.env.HTTP_PROXY  || '',
        GLOBAL_AGENT_HTTP_PROXY:  process.env.GLOBAL_AGENT_HTTP_PROXY || '',
      },
      error_file: `${DEPLOY_DIR}/logs/rv-scheduler-error.log`,
      out_file:   `${DEPLOY_DIR}/logs/rv-scheduler-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '5s',
    },
    {
      name: 'rv-control',
      script: `${DEPLOY_DIR}/dashboard/rv-control.js`,
      cwd: DEPLOY_DIR,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV:   'production',
        DEPLOY_DIR,
        HTTPS_PROXY:              process.env.GLOBAL_AGENT_HTTP_PROXY || process.env.HTTPS_PROXY || '',
        HTTP_PROXY:               process.env.GLOBAL_AGENT_HTTP_PROXY || process.env.HTTP_PROXY  || '',
        GLOBAL_AGENT_HTTP_PROXY:  process.env.GLOBAL_AGENT_HTTP_PROXY || '',
      },
      error_file: `${DEPLOY_DIR}/logs/rv-control-error.log`,
      out_file:   `${DEPLOY_DIR}/logs/rv-control-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      restart_delay: 3000,
      min_uptime: '5s',
    },
  ],
};
