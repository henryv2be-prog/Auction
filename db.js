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

  await seedAdminUser();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS auctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      start_at TEXT NOT NULL DEFAULT (datetime('now')),
      end_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      start_price REAL NOT NULL CHECK (start_price > 0),
      current_price REAL NOT NULL CHECK (current_price > 0),
      start_at TEXT NOT NULL DEFAULT (datetime('now')),
      end_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
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

  await migrateLegacyAssetsToAuctions();

  await db.exec("CREATE INDEX IF NOT EXISTS idx_assets_auction_id ON assets(auction_id);");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_bids_asset_id ON bids(asset_id);");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_asset_media_asset_id ON asset_media(asset_id);");

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

async function migrateLegacyAssetsToAuctions() {
  const columns = await db.all("PRAGMA table_info(assets)");
  const hasAuctionId = columns.some((column) => column.name === "auction_id");

  if (!hasAuctionId) {
    await db.exec("ALTER TABLE assets ADD COLUMN auction_id INTEGER;");
  }

  const unassigned = await db.get("SELECT COUNT(*) AS total FROM assets WHERE auction_id IS NULL");
  if (!unassigned || Number(unassigned.total) === 0) {
    return;
  }

  const adminUser = await db.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
  const fallbackUser = await db.get("SELECT id FROM users ORDER BY id ASC LIMIT 1");
  const summary = await db.get(
    `SELECT MIN(start_at) AS start_at,
            MAX(end_at) AS end_at,
            MIN(created_by) AS created_by
     FROM assets
     WHERE auction_id IS NULL`
  );
  const openAssets = await db.get(
    "SELECT COUNT(*) AS total FROM assets WHERE auction_id IS NULL AND status = 'open'"
  );

  const nowIso = new Date().toISOString();
  const legacyStartAt = (summary && summary.start_at) || nowIso;
  const legacyEndAt =
    (summary && summary.end_at) || new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const legacyStatus = openAssets && Number(openAssets.total) > 0 ? "open" : "closed";
  const createdBy =
    (summary && Number(summary.created_by)) ||
    (adminUser && Number(adminUser.id)) ||
    (fallbackUser && Number(fallbackUser.id));

  if (!createdBy) {
    throw new Error("Unable to migrate legacy assets because no users exist.");
  }

  const legacyAuction = await db.run(
    `INSERT INTO auctions (title, description, start_at, end_at, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    "Legacy Auction",
    "Automatically created to group existing assets into an auction.",
    legacyStartAt,
    legacyEndAt,
    legacyStatus,
    createdBy
  );

  await db.run(
    `UPDATE assets
     SET auction_id = ?,
         end_at = COALESCE(end_at, ?)
     WHERE auction_id IS NULL`,
    legacyAuction.lastID,
    legacyEndAt
  );
}

module.exports = {
  initDb,
  getDb
};
