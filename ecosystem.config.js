'use strict';

module.exports = {
  apps: [
    {
      name: 'rv-scheduler',
      script: 'scheduler.js',
      cwd: '/home/vaultadmin/residualvault',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/rv-scheduler-error.log',
      out_file: './logs/rv-scheduler-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: 'rv-control',
      script: 'dashboard/rv-control.js',
      cwd: '/home/vaultadmin/residualvault',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/rv-control-error.log',
      out_file: './logs/rv-control-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      restart_delay: 3000,
    },
  ],
};
