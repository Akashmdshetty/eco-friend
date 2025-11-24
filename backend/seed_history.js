// seed_history.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'users.db'));

const now = new Date().toISOString();
db.serialize(()=>{
  const stmt = db.prepare('INSERT INTO history (username, filename, processed_at, eco_points_earned, items_recycled, carbon_saved_kg) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run('aakash shetty', 'plastic_bottle.jpg', now, 12, 1, 0.25);
  stmt.run('aakash shetty', 'paper_box.jpg', now, 6, 1, 0.02);
  stmt.finalize(()=> {
    console.log('Seeded history for aakash shetty');
    db.close();
  });
});

