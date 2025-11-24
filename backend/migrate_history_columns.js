// migrate_history_columns.js
// Usage: run from backend folder: node migrate_history_columns.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const DB_FILENAME = 'users.db';
const dbPath = path.join(__dirname, DB_FILENAME);

// Helper: promisify small fs functions
const copyFile = promisify(fs.copyFile);
const stat = promisify(fs.stat);

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch (e) {
    return false;
  }
}

function openDb(p) {
  return new sqlite3.Database(p, sqlite3.OPEN_READWRITE);
}

function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function backupDb(originalPath) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${originalPath}.bak-${ts}`;
  await copyFile(originalPath, backupName);
  return backupName;
}

async function columnExists(db, table, column) {
  const rows = await allAsync(db, `PRAGMA table_info(${table});`);
  return rows.some(r => r.name === column);
}

async function tableExists(db, table) {
  const rows = await allAsync(db, `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [table]);
  return rows.length > 0;
}

(async function main() {
  try {
    if (!(await fileExists(dbPath))) {
      console.error(`❌ Database not found at: ${dbPath}`);
      process.exit(1);
    }

    console.log('🔍 Found DB:', dbPath);
    console.log('📦 Creating backup of DB before migration...');
    const backup = await backupDb(dbPath);
    console.log('✔ Backup created:', backup);

    const db = openDb(dbPath);

    // sanity: ensure 'history' table exists
    const hasHistory = await tableExists(db, 'history');
    if (!hasHistory) {
      console.error("❌ 'history' table not found in DB. Aborting migration.");
      db.close();
      process.exit(1);
    }

    // columns we want to add
    const colsToAdd = [
      { name: 'eco_points_earned', sql: 'INTEGER DEFAULT 0' },
      { name: 'items_recycled', sql: 'INTEGER DEFAULT 0' },
      { name: 'carbon_saved_kg', sql: 'REAL DEFAULT 0.0' }
    ];

    for (const c of colsToAdd) {
      const exists = await columnExists(db, 'history', c.name);
      if (exists) {
        console.log(`ℹ Column already exists: ${c.name}`);
        continue;
      }

      const alterSql = `ALTER TABLE history ADD COLUMN ${c.name} ${c.sql};`;
      console.log(`➕ Adding column: ${c.name}`);
      await runAsync(db, alterSql);
      console.log(`✔ Added column: ${c.name}`);
    }

    // verify
    const finalCols = await allAsync(db, `PRAGMA table_info(history);`);
    const finalNames = finalCols.map(r => r.name);
    console.log('🔁 Columns now on history table:', finalNames);

    console.log('🎉 Migration complete.');
    db.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
})();
