const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcryptjs");
const { resolveDbPath } = require("./storage");

let db;

async function initDb() {
  const filename = resolveDbPath();

  db = await open({
    filename,
    driver: sqlite3.Database
  });

  await db.exec("PRAGMA foreign_keys = ON;");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      start_price REAL NOT NULL CHECK (start_price > 0),
      current_price REAL NOT NULL CHECK (current_price > 0),
      start_at TEXT NOT NULL DEFAULT (datetime('now')),
      end_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS asset_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );
  `);

  await seedAdminUser();

  return db;
}

function getDb() {
  if (!db) {
    throw new Error("Database is not initialized. Call initDb() first.");
  }

  return db;
}

async function seedAdminUser() {
  const adminName = process.env.ADMIN_NAME || "Platform Admin";
  const adminEmail = process.env.ADMIN_EMAIL || "admin@auction.local";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

  const existingAdmin = await db.get("SELECT id FROM users WHERE email = ?", adminEmail);
  if (existingAdmin) {
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await db.run(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES (?, ?, ?, 'admin')`,
    adminName,
    adminEmail,
    passwordHash
  );
}

module.exports = {
  initDb,
  getDb
};
