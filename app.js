require("dotenv").config();

const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const { Server } = require("socket.io");
const multer = require("multer");
const bcrypt = require("bcryptjs");

const { initDb, getDb } = require("./db");
const { resolveSessionDbPath, resolveUploadsDir } = require("./storage");
const { requireRole } = require("./middleware/auth");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const uploadsDir = resolveUploadsDir();

function toPositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallbackValue;
}

function isAllowedMediaType(mimeType) {
  return typeof mimeType === "string" && (mimeType.startsWith("image/") || mimeType.startsWith("video/"));
}

function inferMediaTypeFromMime(mimeType) {
  if (typeof mimeType === "string" && mimeType.startsWith("video/")) {
    return "video";
  }
  return "image";
}

function getSafeFileExtension(fileName) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  if (!/^\.[a-z0-9]+$/.test(extension)) {
    return "";
  }
  return extension;
}

function buildUploadErrorMessage(error) {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return `Each file must be smaller than ${maxMediaFileSizeMb} MB.`;
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return `You can upload up to ${maxMediaFiles} media files per item.`;
    }
    return "Invalid upload request. Please check your files and try again.";
  }
  return error && error.message ? error.message : "Unable to upload media files.";
}

const randFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR"
});
const maxMediaFiles = toPositiveInteger(process.env.MAX_MEDIA_FILES, 8);
const maxMediaFileSizeMb = toPositiveInteger(process.env.MAX_MEDIA_FILE_MB, 50);
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      callback(null, uploadsDir);
    },
    filename(req, file, callback) {
      const extension = getSafeFileExtension(file.originalname);
      callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
    }
  }),
  limits: {
    files: maxMediaFiles,
    fileSize: maxMediaFileSizeMb * 1024 * 1024
  },
  fileFilter(req, file, callback) {
    if (isAllowedMediaType(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error("Only image and video files are allowed."));
  }
});

function adminAssetUpload(req, res, next) {
  upload.array("media", maxMediaFiles)(req, res, async (error) => {
    if (!error) {
      next();
      return;
    }

    await deleteFilesIfPresent(req.files || []);
    return renderAdminDashboard(res, buildUploadErrorMessage(error), 400);
  });
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.locals.formatCurrency = formatCurrency;

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadsDir));

io.on("connection", (socket) => {
  socket.on("asset:subscribe", (assetId) => {
    const normalizedAssetId = Number(assetId);
    if (!Number.isInteger(normalizedAssetId) || normalizedAssetId <= 0) {
      return;
    }
    socket.join(assetRoomName(normalizedAssetId));
  });

  socket.on("asset:unsubscribe", (assetId) => {
    const normalizedAssetId = Number(assetId);
    if (!Number.isInteger(normalizedAssetId) || normalizedAssetId <= 0) {
      return;
    }
    socket.leave(assetRoomName(normalizedAssetId));
  });
});

app.use(
  session({
    store: (() => {
      const sessionDbPath = resolveSessionDbPath();
      return new SQLiteStore({
        db: path.basename(sessionDbPath),
        dir: path.dirname(sessionDbPath)
      });
    })(),
    secret: process.env.SESSION_SECRET || "change-me-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.notice = req.session.notice || null;
  delete req.session.notice;
  next();
});

app.use(async (req, res, next) => {
  try {
    await closeExpiredAssets();
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/", (req, res) => {
  res.redirect("/assets");
});

app.get("/register", (req, res) => {
  if (req.session.user) {
    return res.redirect("/assets");
  }

  return res.render("register", { title: "Register", formError: null });
});

app.post("/register", async (req, res, next) => {
  try {
    if (req.session.user) {
      return res.redirect("/assets");
    }

    const { name, email, password } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!name || !normalizedEmail || !password) {
      return res.status(400).render("register", {
        title: "Register",
        formError: "Name, email, and password are required."
      });
    }

    if (password.length < 6) {
      return res.status(400).render("register", {
        title: "Register",
        formError: "Password must be at least 6 characters long."
      });
    }

    const db = getDb();
    const existingUser = await db.get("SELECT id FROM users WHERE email = ?", normalizedEmail);
    if (existingUser) {
      return res.status(400).render("register", {
        title: "Register",
        formError: "An account with this email already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db.run(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES (?, ?, ?, 'user')`,
      String(name).trim(),
      normalizedEmail,
      passwordHash
    );

    req.session.notice = "Registration successful. Please sign in.";
    return res.redirect("/login");
  } catch (error) {
    return next(error);
  }
});

app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/assets");
  }

  return res.render("login", { title: "Login", formError: null });
});

app.post("/login", async (req, res, next) => {
  try {
    if (req.session.user) {
      return res.redirect("/assets");
    }

    const { email, password } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).render("login", {
        title: "Login",
        formError: "Email and password are required."
      });
    }

    const db = getDb();
    const user = await db.get(
      `SELECT id, name, email, password_hash, role
       FROM users
       WHERE email = ?`,
      normalizedEmail
    );

    if (!user) {
      return res.status(401).render("login", {
        title: "Login",
        formError: "Invalid email or password."
      });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).render("login", {
        title: "Login",
        formError: "Invalid email or password."
      });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    if (user.role === "admin") {
      return res.redirect("/admin");
    }

    return res.redirect("/assets");
  } catch (error) {
    return next(error);
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/assets", async (req, res, next) => {
  try {
    const db = getDb();
    const assets = await db.all(
      `SELECT a.*,
              u.name AS seller_name,
              (SELECT COUNT(*) FROM bids b WHERE b.asset_id = a.id) AS bid_count,
              (SELECT MAX(amount) FROM bids b WHERE b.asset_id = a.id) AS top_bid
       FROM assets a
       JOIN users u ON u.id = a.created_by
       ORDER BY CASE a.status WHEN 'open' THEN 0 ELSE 1 END, a.end_at ASC`
    );

    return res.render("index", { title: "Assets", assets });
  } catch (error) {
    return next(error);
  }
});

app.get("/assets/:id", async (req, res, next) => {
  try {
    const db = getDb();
    const assetId = Number(req.params.id);
    const asset = await db.get(
      `SELECT a.*,
              u.name AS seller_name
       FROM assets a
       JOIN users u ON u.id = a.created_by
       WHERE a.id = ?`,
      assetId
    );

    if (!asset) {
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Asset not found."
      });
    }

    const bids = await db.all(
      `SELECT b.amount, b.created_at, u.name AS bidder_name
       FROM bids b
       JOIN users u ON u.id = b.user_id
       WHERE b.asset_id = ?
       ORDER BY b.amount DESC, b.created_at DESC
       LIMIT 20`,
      assetId
    );
    const media = await getAssetMedia(assetId);

    return res.render("asset-detail", {
      title: asset.title,
      asset,
      bids,
      media,
      formError: null
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/assets/:id/bid", requireRole("user"), async (req, res, next) => {
  const db = getDb();
  const assetId = Number(req.params.id);
  const amount = Number(req.body.amount);

  try {
    if (!Number.isFinite(amount) || amount <= 0) {
      return renderAssetWithError(res, assetId, "Enter a valid bid amount.");
    }

    await db.run("BEGIN IMMEDIATE TRANSACTION");
    const asset = await db.get("SELECT * FROM assets WHERE id = ?", assetId);

    if (!asset) {
      await db.run("ROLLBACK");
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Asset not found."
      });
    }

    if (asset.status !== "open" || new Date(asset.end_at) <= new Date()) {
      if (asset.status === "open") {
        await db.run("UPDATE assets SET status = 'closed' WHERE id = ?", assetId);
      }
      await db.run("COMMIT");
      return renderAssetWithError(res, assetId, "Bidding has closed for this asset.");
    }

    if (amount <= asset.current_price) {
      await db.run("ROLLBACK");
      return renderAssetWithError(
        res,
        assetId,
        `Bid must be greater than the current price (${formatCurrency(asset.current_price)}).`
      );
    }

    await db.run(
      `INSERT INTO bids (asset_id, user_id, amount)
       VALUES (?, ?, ?)`,
      assetId,
      req.session.user.id,
      amount
    );

    await db.run("UPDATE assets SET current_price = ? WHERE id = ?", amount, assetId);
    await db.run("COMMIT");
    await broadcastAssetUpdate(assetId);

    req.session.notice = "Bid submitted successfully.";
    return res.redirect(`/assets/${assetId}`);
  } catch (error) {
    try {
      await db.run("ROLLBACK");
    } catch (rollbackError) {
      // no-op
    }
    return next(error);
  }
});

app.get("/my-bids", requireRole("user"), async (req, res, next) => {
  try {
    const db = getDb();
    const bids = await db.all(
      `SELECT b.id, b.amount, b.created_at, a.id AS asset_id, a.title, a.current_price, a.status
       FROM bids b
       JOIN assets a ON a.id = b.asset_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      req.session.user.id
    );

    return res.render("my-bids", { title: "My Bids", bids });
  } catch (error) {
    return next(error);
  }
});

app.get("/admin", requireRole("admin"), async (req, res, next) => {
  try {
    const db = getDb();
    const assets = await db.all(
      `SELECT a.*,
              (SELECT COUNT(*) FROM bids b WHERE b.asset_id = a.id) AS bid_count
       FROM assets a
       ORDER BY a.created_at DESC`
    );

    return res.render("admin-dashboard", {
      title: "Admin Dashboard",
      assets,
      formError: null
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/assets", requireRole("admin"), adminAssetUpload, async (req, res, next) => {
  const uploadedFiles = req.files || [];
  const db = getDb();
  try {
    const { title, description, startPrice, endAt } = req.body;

    if (!title || !description || !startPrice || !endAt) {
      await deleteFilesIfPresent(uploadedFiles);
      return renderAdminDashboard(
        res,
        "All fields are required to create an auction asset.",
        400
      );
    }

    const price = Number(startPrice);
    const endDate = new Date(endAt);
    const now = new Date();

    if (!Number.isFinite(price) || price <= 0) {
      await deleteFilesIfPresent(uploadedFiles);
      return renderAdminDashboard(res, "Start price must be a valid positive number.", 400);
    }

    if (Number.isNaN(endDate.getTime()) || endDate <= now) {
      await deleteFilesIfPresent(uploadedFiles);
      return renderAdminDashboard(res, "End date must be a valid future date/time.", 400);
    }

    await db.run("BEGIN IMMEDIATE TRANSACTION");
    const result = await db.run(
      `INSERT INTO assets (title, description, start_price, current_price, start_at, end_at, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      String(title).trim(),
      String(description).trim(),
      price,
      price,
      new Date().toISOString(),
      endDate.toISOString(),
      req.session.user.id
    );

    if (uploadedFiles.length) {
      for (const file of uploadedFiles) {
        await db.run(
          `INSERT INTO asset_media (asset_id, media_type, file_path, original_name)
           VALUES (?, ?, ?, ?)`,
          result.lastID,
          inferMediaTypeFromMime(file.mimetype),
          file.filename,
          file.originalname
        );
      }
    }

    await db.run("COMMIT");
    await broadcastAssetUpdate(result.lastID);

    req.session.notice = "Asset created and opened for bidding.";
    return res.redirect("/admin");
  } catch (error) {
    try {
      await db.run("ROLLBACK");
    } catch (rollbackError) {
      // no-op
    }
    await deleteFilesIfPresent(uploadedFiles);
    return next(error);
  }
});

app.post("/admin/assets/:id/close", requireRole("admin"), async (req, res, next) => {
  try {
    const db = getDb();
    const assetId = Number(req.params.id);
    await db.run("UPDATE assets SET status = 'closed' WHERE id = ?", assetId);
    await broadcastAssetUpdate(assetId);
    req.session.notice = "Auction closed successfully.";
    return res.redirect("/admin");
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).render("error", {
    title: "Not Found",
    message: "The requested page could not be found."
  });
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError || error.message === "Only image and video files are allowed.") {
    return renderAdminDashboard(res, buildUploadErrorMessage(error), 400);
  }

  console.error(error);
  res.status(500).render("error", {
    title: "Server Error",
    message: "An unexpected error occurred."
  });
});

async function renderAssetWithError(res, assetId, formError) {
  const db = getDb();
  const asset = await db.get(
    `SELECT a.*, u.name AS seller_name
     FROM assets a
     JOIN users u ON u.id = a.created_by
     WHERE a.id = ?`,
    assetId
  );
  const bids = await db.all(
    `SELECT b.amount, b.created_at, u.name AS bidder_name
     FROM bids b
     JOIN users u ON u.id = b.user_id
     WHERE b.asset_id = ?
     ORDER BY b.amount DESC, b.created_at DESC
     LIMIT 20`,
    assetId
  );

  return res.status(400).render("asset-detail", {
    title: asset ? asset.title : "Asset",
    asset,
    bids,
    media: asset ? await getAssetMedia(asset.id) : [],
    formError
  });
}

async function renderAdminDashboard(res, formError, statusCode) {
  const db = getDb();
  const assets = await db.all(
    `SELECT a.*,
            (SELECT COUNT(*) FROM bids b WHERE b.asset_id = a.id) AS bid_count
     FROM assets a
     ORDER BY a.created_at DESC`
  );
  return res.status(statusCode).render("admin-dashboard", {
    title: "Admin Dashboard",
    assets,
    formError
  });
}

async function closeExpiredAssets() {
  const db = getDb();
  const expiredAssets = await db.all(
    `SELECT id
     FROM assets
     WHERE status = 'open' AND end_at <= ?`,
    new Date().toISOString()
  );
  if (!expiredAssets.length) {
    return;
  }

  await db.run(
    `UPDATE assets
     SET status = 'closed'
     WHERE id IN (${expiredAssets.map(() => "?").join(",")})`,
    ...expiredAssets.map((asset) => asset.id)
  );

  await Promise.all(expiredAssets.map((asset) => broadcastAssetUpdate(asset.id)));
}

function formatCurrency(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return randFormatter.format(0);
  }
  return randFormatter.format(numericValue);
}

async function getAssetMedia(assetId) {
  const db = getDb();
  const media = await db.all(
    `SELECT id, media_type, file_path, original_name, created_at
     FROM asset_media
     WHERE asset_id = ?
     ORDER BY created_at ASC, id ASC`,
    assetId
  );

  return media.map(mapMediaForView);
}

function mapMediaForView(mediaItem) {
  return {
    ...mediaItem,
    file_path: `/uploads/${encodeURIComponent(mediaItem.file_path)}`
  };
}

async function deleteFilesIfPresent(files) {
  if (!Array.isArray(files) || !files.length) {
    return;
  }

  await Promise.all(
    files.map(async (file) => {
      if (!file || !file.path) {
        return;
      }

      try {
        await fs.unlink(file.path);
      } catch (error) {
        if (error && error.code !== "ENOENT") {
          console.error("Failed to delete uploaded file:", error);
        }
      }
    })
  );
}

const PORT = process.env.PORT || 3000;

async function start() {
  await initDb();
  httpServer.listen(PORT, () => {
    console.log(`Auction platform running on http://localhost:${PORT}`);
  });
}

function assetRoomName(assetId) {
  return `asset:${assetId}`;
}

async function broadcastAssetUpdate(assetId) {
  const db = getDb();
  const asset = await db.get(
    `SELECT id, title, current_price, status
     FROM assets
     WHERE id = ?`,
    assetId
  );
  if (!asset) {
    return;
  }

  const bidCountRow = await db.get(
    `SELECT COUNT(*) AS bid_count
     FROM bids
     WHERE asset_id = ?`,
    assetId
  );
  const latestBid = await db.get(
    `SELECT b.amount, b.created_at, u.name AS bidder_name
     FROM bids b
     JOIN users u ON u.id = b.user_id
     WHERE b.asset_id = ?
     ORDER BY b.created_at DESC
     LIMIT 1`,
    assetId
  );
  const mediaCountRow = await db.get(
    `SELECT COUNT(*) AS media_count
     FROM asset_media
     WHERE asset_id = ?`,
    assetId
  );

  const payload = {
    assetId: asset.id,
    title: asset.title,
    currentPrice: Number(asset.current_price),
    status: asset.status,
    bidCount: bidCountRow ? Number(bidCountRow.bid_count) : 0,
    mediaCount: mediaCountRow ? Number(mediaCountRow.media_count) : 0,
    latestBid: latestBid
      ? {
          amount: Number(latestBid.amount),
          bidderName: latestBid.bidder_name,
          createdAt: latestBid.created_at
        }
      : null
  };

  io.to(assetRoomName(assetId)).emit("asset:update", payload);
  io.emit("asset:listing-update", payload);
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start app:", error);
    process.exit(1);
  });
}

module.exports = { app, io, start };
