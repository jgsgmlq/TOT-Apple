'use strict';

module.exports = {
  apps: [
    {
      name: 'tot-api',
      script: './app.js',
      instances: 1, // SQLite 单写，禁止多实例
      max_memory_restart: '400M',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // 开发环境：pm2 start ecosystem.config.js --env development
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      // 生产环境：pm2 start ecosystem.config.js --env production
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
