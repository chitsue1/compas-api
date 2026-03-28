require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function run() {
  const client = await pool.connect();
  try {
    // Run all .sql files in order
    const files = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sqlFile = path.join(__dirname, file);
      const sql = fs.readFileSync(sqlFile, 'utf-8');
      console.log(`Running ${file}...`);
      await client.query(sql);
      console.log(`✅ ${file} complete`);
    }
    console.log('\n✅ All migrations complete');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
