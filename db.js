// Step 1: connect to the MySQL database
const mysql = require('mysql2/promise');
const settings = require('./settings');

const poolConfig = {
  host: settings.DB_HOST,
  port: settings.DB_PORT,
  user: settings.DB_USER,
  password: settings.DB_PASSWORD,
  database: settings.DB_NAME,
  connectionLimit: 10
};

// Enable SSL when configured (required by cloud providers like TiDB Cloud, Aiven, etc.)
if (settings.DB_SSL) {
  poolConfig.ssl = {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  };
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;
