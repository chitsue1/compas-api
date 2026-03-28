require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
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