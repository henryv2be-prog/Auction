const fs = require("fs");
const os = require("os");
const path = require("path");

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function resolveDataDir() {
  const configuredDataDir = String(process.env.DATA_DIR || "").trim();
  let baseDir;
  if (configuredDataDir) {
    baseDir = path.resolve(configuredDataDir);
  } else if (process.env.NODE_ENV === "production") {
    baseDir = path.join(os.tmpdir(), "auction-data");
  } else {
    baseDir = path.resolve(process.cwd(), "data");
  }

  return ensureDirectory(baseDir);
}

function resolveDbPath() {
  const configuredDbPath = String(process.env.DB_PATH || "").trim();
  if (configuredDbPath) {
    const absoluteDbPath = path.resolve(configuredDbPath);
    ensureDirectory(path.dirname(absoluteDbPath));
    return absoluteDbPath;
  }

  return path.join(resolveDataDir(), "auction.db");
}

function resolveSessionStoreDir() {
  const configuredSessionDir = String(process.env.SESSION_DB_DIR || "").trim();
  if (configuredSessionDir) {
    return ensureDirectory(path.resolve(configuredSessionDir));
  }

  return resolveDataDir();
}

function resolveSessionDbPath() {
  const configuredSessionDbPath = String(process.env.SESSION_DB_PATH || "").trim();
  if (configuredSessionDbPath) {
    const absoluteSessionDbPath = path.resolve(configuredSessionDbPath);
    ensureDirectory(path.dirname(absoluteSessionDbPath));
    return absoluteSessionDbPath;
  }

  return path.join(resolveDataDir(), "sessions.sqlite");
}

function resolveUploadsDir() {
  const configuredUploadsDir = String(process.env.UPLOADS_DIR || "").trim();
  if (configuredUploadsDir) {
    return ensureDirectory(path.resolve(configuredUploadsDir));
  }

  return ensureDirectory(path.join(resolveDataDir(), "uploads"));
}

module.exports = {
  resolveDataDir,
  resolveDbPath,
  resolveSessionStoreDir,
  resolveSessionDbPath,
  resolveUploadsDir
};
