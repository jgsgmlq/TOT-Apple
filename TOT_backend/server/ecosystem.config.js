'use strict';

module.exports = {
  apps: [
    {
      name: 'tot-api',
      script: './app.js',
      instances: 1,          // SQLite 单写，禁止多实例
      exec_mode: 'fork',     // fork 模式，cluster 模式会与 SQLite 冲突
      max_memory_restart: '400M',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // 默认环境（pm2 start ecosystem.config.js）
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      // 显式指定开发环境（pm2 start ... --env development）
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      // 生产环境（pm2 start ... --env production）
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
