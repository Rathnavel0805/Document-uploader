// ============================================================
// Configuration settings
// Reads from environment variables in production, with local fallbacks
// ============================================================
module.exports = {
  PORT: process.env.PORT || 3000,

  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'root',
  DB_NAME: process.env.DB_NAME || 'my_new_schema',
  DB_SSL: process.env.DB_SSL === 'true' || process.env.DB_SSL === '1',

  // Maximum size of the final image (15 KB)
  MAX_KB: process.env.MAX_KB ? Number(process.env.MAX_KB) : 15,

  // Pass key for the admin page (choose your own, at least 8 characters)
  ADMIN_KEY: process.env.ADMIN_KEY || 'AdminKey@2026'
};