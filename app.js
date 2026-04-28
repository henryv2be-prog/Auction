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
const {
  parseSastInputToUtc,
  formatSastDateTime,
  formatForDatetimeLocalInput,
  SAST_TIMEZONE
} = require("./time");

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

function applyNoStoreHeaders(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function shouldDisableBrowserPageCache(reqPath) {
  return !/\.[a-z0-9]+$/i.test(reqPath || "");
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
  upload.array("media", maxMediaFiles)(req, res, next);
}

function wantsJson(req) {
  if (!req) {
    return false;
  }
  if (req.xhr) {
    return true;
  }
  const requestedWith = req.get("X-Requested-With");
  if (requestedWith && requestedWith.toLowerCase() === "xmlhttprequest") {
    return true;
  }
  const accept = req.get("Accept") || "";
  return accept.indexOf("application/json") !== -1 && accept.indexOf("text/html") === -1;
}

function jsonOk(res, payload) {
  return res.status(200).json(Object.assign({ ok: true }, payload || {}));
}

function jsonError(res, statusCode, message) {
  return res.status(statusCode).json({ ok: false, error: message });
}

function isClientAbortError(error) {
  if (!error) {
    return false;
  }
  if (error.code === "ECONNRESET" || error.code === "ECONNABORTED") {
    return true;
  }
  if (error.type === "request.aborted") {
    return true;
  }
  return error.message === "Request aborted" || error.message === "aborted";
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.locals.formatCurrency = formatCurrency;
app.locals.formatSastDateTime = formatSastDateTime;
app.locals.formatForDatetimeLocalInput = formatForDatetimeLocalInput;
app.locals.SAST_TIMEZONE = SAST_TIMEZONE;
app.locals.assetVersion = process.env.ASSET_VERSION || "20260428l";

const staticAssetOptions = {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (/\.(css|js|mjs|map)$/i.test(filePath)) {
      applyNoStoreHeaders(res);
    }
  }
};

const uploadStaticOptions = {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    applyNoStoreHeaders(res);
  }
};

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public"), staticAssetOptions));
app.use("/uploads", express.static(uploadsDir, uploadStaticOptions));
app.use((req, res, next) => {
  if ((req.method === "GET" || req.method === "HEAD") && shouldDisableBrowserPageCache(req.path)) {
    applyNoStoreHeaders(res);
  }
  next();
});

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
    await closeExpiredAuctions();
    await detectAuctionPhaseTransitions();
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
    const nowIso = new Date().toISOString();
    const auctions = await db.all(
      `SELECT a.id,
              a.title AS name,
              a.description,
              a.start_at,
              a.end_at,
              a.status,
              (SELECT COUNT(*) FROM assets x WHERE x.auction_id = a.id) AS asset_count
       FROM auctions a
       ORDER BY a.start_at ASC`
    );

    const liveAuctions = [];
    const upcomingAuctions = [];
    const pastAuctions = [];
    const nowMs = Date.now();
    for (const auction of auctions) {
      const phase = deriveAuctionPhase(auction, nowMs);
      auction.phase = phase;
      if (phase === "closed") {
        pastAuctions.push(auction);
      } else if (phase === "live") {
        liveAuctions.push(auction);
      } else {
        upcomingAuctions.push(auction);
      }
    }

    liveAuctions.sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
    upcomingAuctions.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    pastAuctions.sort((a, b) => new Date(b.end_at) - new Date(a.end_at));

    return res.render("index", {
      title: "Auctions",
      liveAuctions,
      upcomingAuctions,
      pastAuctions,
      currentTime: nowIso
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/auctions/:id", async (req, res, next) => {
  try {
    const db = getDb();
    const auctionId = Number(req.params.id);
    if (!Number.isInteger(auctionId) || auctionId <= 0) {
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Auction not found."
      });
    }

    const auction = await db.get(
      `SELECT id, title AS name, description, start_at, end_at, status
       FROM auctions
       WHERE id = ?`,
      auctionId
    );
    if (!auction) {
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Auction not found."
      });
    }
    auction.phase = deriveAuctionPhase(auction);

    const assets = await db.all(
      `SELECT a.*,
              auc.title AS auction_title,
              u.name AS seller_name,
              (SELECT COUNT(*) FROM bids b WHERE b.asset_id = a.id) AS bid_count
       FROM assets a
       JOIN auctions auc ON auc.id = a.auction_id
       JOIN users u ON u.id = a.created_by
       WHERE a.auction_id = ?
       ORDER BY CASE a.status WHEN 'open' THEN 0 ELSE 1 END, a.end_at ASC`,
      auctionId
    );

    const assetIds = assets.map((asset) => asset.id);
    const thumbnailsByAssetId = new Map();
    if (assetIds.length) {
      const placeholders = assetIds.map(() => "?").join(",");
      const thumbnailRows = await db.all(
        `SELECT asset_id, media_type, file_path, original_name
         FROM asset_media
         WHERE id IN (
           SELECT MIN(id) FROM asset_media
           WHERE asset_id IN (${placeholders})
           GROUP BY asset_id
         )`,
        ...assetIds
      );
      for (const row of thumbnailRows) {
        thumbnailsByAssetId.set(row.asset_id, mapMediaForView(row));
      }
    }

    const assetsWithThumbnail = assets.map((asset) => ({
      ...asset,
      thumbnail: thumbnailsByAssetId.get(asset.id) || null
    }));

    return res.render("auction-detail", {
      title: auction.name,
      auction,
      assets: assetsWithThumbnail
    });
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
              auc.id AS auction_id,
              auc.title AS auction_title,
              auc.status AS auction_status,
              auc.end_at AS auction_end_at,
              u.name AS seller_name
       FROM assets a
       JOIN auctions auc ON auc.id = a.auction_id
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
    const asset = await db.get(
      `SELECT a.*, auc.start_at AS auction_start_at, auc.end_at AS auction_end_at, auc.status AS auction_status
       FROM assets a
       JOIN auctions auc ON auc.id = a.auction_id
       WHERE a.id = ?`,
      assetId
    );

    if (!asset) {
      await db.run("ROLLBACK");
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Asset not found."
      });
    }

    const now = new Date();
    const auctionStartsAt = asset.auction_start_at ? new Date(asset.auction_start_at) : null;
    const auctionEndsAt = asset.auction_end_at ? new Date(asset.auction_end_at) : null;

    if (auctionStartsAt && auctionStartsAt > now) {
      await db.run("ROLLBACK");
      return renderAssetWithError(
        res,
        assetId,
        `Bidding opens at ${formatSastDateTime(auctionStartsAt)} (SAST).`
      );
    }

    const auctionEnded =
      asset.auction_status === "closed" || (auctionEndsAt && auctionEndsAt <= now);
    if (asset.status !== "open" || (asset.end_at && new Date(asset.end_at) <= now) || auctionEnded) {
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

app.get("/admin", requireRole("admin"), async (req, res) => {
  return res.redirect("/admin/auctions");
});

app.get("/admin/auctions", requireRole("admin"), async (req, res, next) => {
  try {
    const auctions = await listAuctionsWithCounts();
    return res.render("admin-auctions", {
      title: "Auction Management",
      auctions,
      formError: null
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/auctions", requireRole("admin"), async (req, res, next) => {
  try {
    const data = validateAuctionFields(req.body);
    const db = getDb();
    const result = await db.run(
      `INSERT INTO auctions (title, description, start_at, end_at, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      data.name,
      data.description,
      data.startAt.toISOString(),
      data.endAt.toISOString(),
      data.status,
      req.session.user.id
    );

    if (result && result.lastID) {
      await broadcastAuctionUpdate(result.lastID);
    }
    await detectAuctionPhaseTransitions();
    req.session.notice = "Auction created successfully.";
    return res.redirect("/admin/auctions");
  } catch (error) {
    if (error instanceof ValidationError) {
      return renderAdminAuctionsWithError(res, error.message, 400);
    }
    return next(error);
  }
});

app.get("/admin/auctions/:id/edit", requireRole("admin"), async (req, res, next) => {
  try {
    const auctionId = Number(req.params.id);
    const auction = await getAuctionById(auctionId);
    if (!auction) {
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Auction not found."
      });
    }

    const assets = await listAuctionAssets(auctionId);
    return res.render("admin-auction-detail", {
      title: `Manage ${auction.name}`,
      auction,
      assets,
      formError: null
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/auctions/:id/edit", requireRole("admin"), async (req, res, next) => {
  const auctionId = Number(req.params.id);
  try {
    const existingAuction = await getAuctionById(auctionId);
    if (!existingAuction) {
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Auction not found."
      });
    }

    const data = validateAuctionFields(req.body);
    const db = getDb();
    await db.run(
      `UPDATE auctions
       SET title = ?, description = ?, status = ?, start_at = ?, end_at = ?
       WHERE id = ?`,
      data.name,
      data.description,
      data.status,
      data.startAt.toISOString(),
      data.endAt.toISOString(),
      auctionId
    );
    await syncAuctionAssetsWithAuctionWindow(auctionId);
    await detectAuctionPhaseTransitions();
    await broadcastAuctionUpdate(auctionId);

    req.session.notice = "Auction updated.";
    return res.redirect(`/admin/auctions/${auctionId}/edit`);
  } catch (error) {
    if (error instanceof ValidationError) {
      return renderAdminAuctionDetailWithError(res, auctionId, error.message, 400);
    }
    return next(error);
  }
});

app.post("/admin/auctions/:id/close", requireRole("admin"), async (req, res, next) => {
  const auctionId = Number(req.params.id);
  try {
    const db = getDb();
    await db.run("BEGIN IMMEDIATE TRANSACTION");
    await db.run("UPDATE auctions SET status = 'closed' WHERE id = ?", auctionId);
    const assets = await db.all("SELECT id FROM assets WHERE auction_id = ?", auctionId);
    await db.run("UPDATE assets SET status = 'closed' WHERE auction_id = ?", auctionId);
    await db.run("COMMIT");

    await Promise.all(assets.map((asset) => broadcastAssetUpdate(asset.id)));
    await broadcastAuctionUpdate(auctionId);
    await detectAuctionPhaseTransitions();

    req.session.notice = "Auction closed successfully.";
    return res.redirect(`/admin/auctions/${auctionId}/edit`);
  } catch (error) {
    try {
      await getDb().run("ROLLBACK");
    } catch (rollbackError) {
      // no-op
    }
    return next(error);
  }
});

app.post(
  "/admin/auctions/:id/assets",
  requireRole("admin"),
  adminAssetUpload,
  async (req, res, next) => {
    const auctionId = Number(req.params.id);
    const uploadedFiles = req.files || [];
    const wantJson = wantsJson(req);
    const db = getDb();
    try {
      const auction = await getAuctionById(auctionId);
      if (!auction) {
        await deleteFilesIfPresent(uploadedFiles);
        if (wantJson) {
          return jsonError(res, 404, "Auction not found.");
        }
        return res.status(404).render("error", {
          title: "Not Found",
          message: "Auction not found."
        });
      }

      const data = validateAssetFields(req.body);
      let createdAssetId = null;
      await runInTransaction(db, async () => {
        const result = await db.run(
          `INSERT INTO assets
           (auction_id, title, description, start_price, current_price, start_at, end_at, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          auctionId,
          data.title,
          data.description,
          data.startPrice,
          data.startPrice,
          auction.start_at,
          auction.end_at,
          auction.status === "open" ? "open" : "closed",
          req.session.user.id
        );
        createdAssetId = result.lastID;
        await saveAssetMediaFiles(db, result.lastID, uploadedFiles);
      });

      if (createdAssetId) {
        await broadcastAssetUpdate(createdAssetId);
      }
      await broadcastAuctionUpdate(auctionId);

      const redirectTo = `/admin/auctions/${auctionId}/edit`;
      req.session.notice = "Asset added to auction.";
      if (wantJson) {
        return jsonOk(res, {
          message: "Asset added to auction.",
          redirect: redirectTo,
          assetId: createdAssetId
        });
      }
      return res.redirect(redirectTo);
    } catch (error) {
      await deleteFilesIfPresent(uploadedFiles);
      if (error instanceof ValidationError) {
        if (wantJson) {
          return jsonError(res, 400, error.message);
        }
        return renderAdminAuctionDetailWithError(res, auctionId, error.message, 400);
      }
      if (wantJson && !res.headersSent) {
        const message =
          error instanceof multer.MulterError
            ? buildUploadErrorMessage(error)
            : "An unexpected error occurred while saving the asset.";
        const statusCode = error instanceof multer.MulterError ? 400 : 500;
        if (!(error instanceof multer.MulterError)) {
          console.error(error);
        }
        return jsonError(res, statusCode, message);
      }
      return next(error);
    }
  }
);

app.get("/admin/assets/:id/edit", requireRole("admin"), async (req, res, next) => {
  try {
    const assetId = Number(req.params.id);
    const asset = await getAssetById(assetId);
    if (!asset) {
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Asset not found."
      });
    }
    const auction = await getAuctionById(asset.auction_id);
    const media = await getAssetMedia(assetId);
    return res.render("admin-asset-edit", {
      title: `Edit ${asset.title}`,
      asset,
      auction,
      media,
      formError: null
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/assets/:id/edit", requireRole("admin"), adminAssetUpload, async (req, res, next) => {
  const assetId = Number(req.params.id);
  const uploadedFiles = req.files || [];
  const wantJson = wantsJson(req);
  const db = getDb();
  try {
    const asset = await getAssetById(assetId);
    if (!asset) {
      await deleteFilesIfPresent(uploadedFiles);
      if (wantJson) {
        return jsonError(res, 404, "Asset not found.");
      }
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Asset not found."
      });
    }

    const data = validateAssetEditFields(req.body);
    await runInTransaction(db, async () => {
      await db.run(
        `UPDATE assets
         SET title = ?, description = ?, start_price = ?, end_at = ?, status = ?
         WHERE id = ?`,
        data.title,
        data.description,
        data.startPrice,
        data.endAt.toISOString(),
        data.status,
        assetId
      );
      await saveAssetMediaFiles(db, assetId, uploadedFiles);
      await db.run(
        `UPDATE assets
         SET current_price = CASE
           WHEN current_price < ? THEN ?
           ELSE current_price
         END
         WHERE id = ?`,
        data.startPrice,
        data.startPrice,
        assetId
      );
    });

    await broadcastAssetUpdate(assetId);
    const redirectTo = `/admin/assets/${assetId}/edit`;
    req.session.notice = "Asset updated.";
    if (wantJson) {
      return jsonOk(res, { message: "Asset updated.", redirect: redirectTo });
    }
    return res.redirect(redirectTo);
  } catch (error) {
    await deleteFilesIfPresent(uploadedFiles);
    if (error instanceof ValidationError) {
      if (wantJson) {
        return jsonError(res, 400, error.message);
      }
      return renderAdminAssetEditWithError(res, assetId, error.message, 400);
    }
    if (wantJson && !res.headersSent) {
      const message =
        error instanceof multer.MulterError
          ? buildUploadErrorMessage(error)
          : "An unexpected error occurred while saving the asset.";
      const statusCode = error instanceof multer.MulterError ? 400 : 500;
      if (!(error instanceof multer.MulterError)) {
        console.error(error);
      }
      return jsonError(res, statusCode, message);
    }
    return next(error);
  }
});

app.post("/admin/assets/:id/remove", requireRole("admin"), async (req, res, next) => {
  const assetId = Number(req.params.id);
  try {
    const asset = await getAssetById(assetId);
    if (!asset) {
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Asset not found."
      });
    }

    const media = await getAssetMediaRaw(assetId);
    await getDb().run("DELETE FROM assets WHERE id = ?", assetId);
    await deleteMediaFilesByRows(media);
    await broadcastAuctionUpdate(asset.auction_id);

    req.session.notice = "Asset removed from auction.";
    return res.redirect(`/admin/auctions/${asset.auction_id}/edit`);
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/media/:id/delete", requireRole("admin"), async (req, res, next) => {
  const mediaId = Number(req.params.id);
  try {
    const db = getDb();
    const media = await db.get("SELECT id, asset_id, file_path FROM asset_media WHERE id = ?", mediaId);
    if (!media) {
      return res.status(404).render("error", {
        title: "Not Found",
        message: "Media file not found."
      });
    }

    await db.run("DELETE FROM asset_media WHERE id = ?", mediaId);
    await deleteMediaFilesByRows([media]);
    req.session.notice = "Media removed.";
    return res.redirect(`/admin/assets/${media.asset_id}/edit`);
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
  if (isClientAbortError(error)) {
    if (!res.headersSent) {
      try {
        res.status(499).end();
      } catch (closeError) {
        // ignore: socket already closed
      }
    }
    return;
  }

  if (error instanceof multer.MulterError || error.message === "Only image and video files are allowed.") {
    if (wantsJson(req)) {
      return jsonError(res, 400, buildUploadErrorMessage(error));
    }
    const auctionIdMatch = req.path.match(/^\/admin\/auctions\/(\d+)\/assets$/);
    if (auctionIdMatch) {
      const auctionId = Number(auctionIdMatch[1]);
      return renderAdminAuctionDetailWithError(res, auctionId, buildUploadErrorMessage(error), 400);
    }
    const assetEditMatch = req.path.match(/^\/admin\/assets\/(\d+)\/edit$/);
    if (assetEditMatch) {
      const assetId = Number(assetEditMatch[1]);
      return renderAdminAssetEditWithError(res, assetId, buildUploadErrorMessage(error), 400);
    }
    return renderAdminAuctionsWithError(res, buildUploadErrorMessage(error), 400);
  }

  console.error(error);
  if (wantsJson(req)) {
    return jsonError(res, 500, "An unexpected error occurred.");
  }
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

async function renderAdminAuctionsWithError(res, formError, statusCode) {
  const auctions = await listAuctionsWithCounts();
  return res.status(statusCode).render("admin-auctions", {
    title: "Auction Management",
    auctions,
    formError
  });
}

async function renderAdminAuctionDetailWithError(res, auctionId, formError, statusCode) {
  const auction = await getAuctionById(auctionId);
  if (!auction) {
    return res.status(404).render("error", {
      title: "Not Found",
      message: "Auction not found."
    });
  }
  const assets = await listAuctionAssets(auctionId);
  return res.status(statusCode).render("admin-auction-detail", {
    title: `Manage ${auction.name}`,
    auction,
    assets,
    formError
  });
}

async function renderAdminAssetEditWithError(res, assetId, formError, statusCode) {
  const asset = await getAssetById(assetId);
  if (!asset) {
    return res.status(404).render("error", {
      title: "Not Found",
      message: "Asset not found."
    });
  }
  const auction = await getAuctionById(asset.auction_id);
  const media = await getAssetMedia(assetId);
  return res.status(statusCode).render("admin-asset-edit", {
    title: `Edit ${asset.title}`,
    asset,
    auction,
    media,
    formError
  });
}

function deriveAuctionPhase(auction, nowMs) {
  if (!auction) {
    return "closed";
  }
  if (auction.status === "closed") {
    return "closed";
  }
  const startsAt = auction.start_at ? new Date(auction.start_at).getTime() : NaN;
  const endsAt = auction.end_at ? new Date(auction.end_at).getTime() : NaN;
  const reference = typeof nowMs === "number" ? nowMs : Date.now();

  if (Number.isFinite(endsAt) && endsAt <= reference) {
    return "closed";
  }
  if (Number.isFinite(startsAt) && startsAt > reference) {
    return "upcoming";
  }
  return "live";
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
    return [];
  }

  await db.run(
    `UPDATE assets
     SET status = 'closed'
     WHERE id IN (${expiredAssets.map(() => "?").join(",")})`,
    ...expiredAssets.map((asset) => asset.id)
  );

  await Promise.all(expiredAssets.map((asset) => broadcastAssetUpdate(asset.id)));
  return expiredAssets.map((asset) => asset.id);
}

async function closeExpiredAuctions() {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const expiredAuctions = await db.all(
    `SELECT id
     FROM auctions
     WHERE status = 'open' AND end_at <= ?`,
    nowIso
  );
  if (!expiredAuctions.length) {
    return [];
  }

  const ids = expiredAuctions.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  await db.run(
    `UPDATE auctions
     SET status = 'closed'
     WHERE id IN (${placeholders})`,
    ...ids
  );
  await db.run(
    `UPDATE assets
     SET status = 'closed'
     WHERE auction_id IN (${placeholders}) AND status = 'open'`,
    ...ids
  );

  await Promise.all(ids.map((id) => broadcastAuctionUpdate(id)));
  return ids;
}

let lastAuctionPhases = new Map();

async function detectAuctionPhaseTransitions() {
  const db = getDb();
  const auctions = await db.all(
    `SELECT id, status, start_at, end_at FROM auctions`
  );
  const nowMs = Date.now();
  const transitioned = [];
  const nextSnapshot = new Map();

  for (const auction of auctions) {
    const phase = deriveAuctionPhase(auction, nowMs);
    nextSnapshot.set(auction.id, phase);
    const previousPhase = lastAuctionPhases.get(auction.id);
    if (previousPhase && previousPhase !== phase) {
      transitioned.push({ id: auction.id, from: previousPhase, to: phase });
    }
  }

  lastAuctionPhases = nextSnapshot;

  if (!transitioned.length) {
    return transitioned;
  }

  await Promise.all(
    transitioned.map(({ id }) => broadcastAuctionUpdate(id))
  );

  return transitioned;
}

async function runScheduledSweep() {
  try {
    await closeExpiredAssets();
    await closeExpiredAuctions();
    await detectAuctionPhaseTransitions();
  } catch (error) {
    console.error("Scheduled auction sweep failed:", error);
  }
}

const AUCTION_SWEEP_INTERVAL_MS = Number(process.env.AUCTION_SWEEP_INTERVAL_MS) || 30 * 1000;
let auctionSweepTimer = null;

function startAuctionSweep() {
  if (auctionSweepTimer) {
    return;
  }
  runScheduledSweep();
  auctionSweepTimer = setInterval(runScheduledSweep, AUCTION_SWEEP_INTERVAL_MS);
  if (auctionSweepTimer.unref) {
    auctionSweepTimer.unref();
  }
}

class ValidationError extends Error {}

function validateAuctionFields(body) {
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const status = String(body.status || "draft").trim().toLowerCase();
  const startAt = parseSastInputToUtc(body.startAt);
  const endAt = parseSastInputToUtc(body.endAt);

  if (!name) {
    throw new ValidationError("Auction name is required.");
  }
  if (!["draft", "open", "closed"].includes(status)) {
    throw new ValidationError("Invalid auction status.");
  }
  if (!startAt || !endAt) {
    throw new ValidationError("Auction start and end dates are required (entered in SAST).");
  }
  if (endAt <= startAt) {
    throw new ValidationError("Auction end date must be after start date.");
  }

  return {
    name,
    description,
    status,
    startAt,
    endAt
  };
}

function validateAssetFields(body) {
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const startPrice = Number(body.startPrice);

  if (!title || !description) {
    throw new ValidationError("Asset title and description are required.");
  }
  if (!Number.isFinite(startPrice) || startPrice <= 0) {
    throw new ValidationError("Start price must be a positive number.");
  }

  return {
    title,
    description,
    startPrice
  };
}

function validateAssetEditFields(body) {
  const base = validateAssetFields(body);
  const status = String(body.status || "").trim().toLowerCase();
  const endAt = parseSastInputToUtc(body.endAt);

  if (!["open", "closed"].includes(status)) {
    throw new ValidationError("Asset status must be open or closed.");
  }
  if (!endAt) {
    throw new ValidationError("Asset end date is invalid.");
  }

  return {
    ...base,
    status,
    endAt
  };
}

async function listAuctionsWithCounts() {
  const db = getDb();
  return db.all(
    `SELECT a.id,
            a.title AS name,
            a.description,
            a.start_at,
            a.end_at,
            a.status,
            (SELECT COUNT(*) FROM assets s WHERE s.auction_id = a.id) AS asset_count
     FROM auctions a
     ORDER BY a.created_at DESC`
  );
}

async function listAuctionAssets(auctionId) {
  const db = getDb();
  return db.all(
    `SELECT a.id,
            a.auction_id,
            a.title,
            a.description,
            a.start_price,
            a.current_price,
            a.start_at,
            a.end_at,
            a.status,
            (SELECT COUNT(*) FROM bids b WHERE b.asset_id = a.id) AS bid_count
     FROM assets a
     WHERE a.auction_id = ?
     ORDER BY a.created_at DESC`,
    auctionId
  );
}

async function getAuctionById(auctionId) {
  const db = getDb();
  return db.get(
    `SELECT id,
            title AS name,
            description,
            start_at,
            end_at,
            status
     FROM auctions
     WHERE id = ?`,
    auctionId
  );
}

async function getAssetById(assetId) {
  const db = getDb();
  return db.get(
    `SELECT id,
            auction_id,
            title,
            description,
            start_price,
            current_price,
            start_at,
            end_at,
            status
     FROM assets
     WHERE id = ?`,
    assetId
  );
}

async function getAssetMediaRaw(assetId) {
  const db = getDb();
  return db.all(
    `SELECT id, asset_id, media_type, file_path, original_name
     FROM asset_media
     WHERE asset_id = ?`,
    assetId
  );
}

async function saveAssetMediaFiles(db, assetId, uploadedFiles) {
  if (!uploadedFiles.length) {
    return;
  }

  for (const file of uploadedFiles) {
    await db.run(
      `INSERT INTO asset_media (asset_id, media_type, file_path, original_name)
       VALUES (?, ?, ?, ?)`,
      assetId,
      inferMediaTypeFromMime(file.mimetype),
      file.filename,
      file.originalname
    );
  }
}

async function deleteMediaFilesByRows(rows) {
  const files = rows.map((row) => ({ path: path.join(uploadsDir, row.file_path) }));
  await deleteFilesIfPresent(files);
}

async function runInTransaction(db, callback) {
  await db.run("BEGIN IMMEDIATE TRANSACTION");
  try {
    await callback();
    await db.run("COMMIT");
  } catch (error) {
    try {
      await db.run("ROLLBACK");
    } catch (rollbackError) {
      // no-op
    }
    throw error;
  }
}

async function syncAuctionAssetsWithAuctionWindow(auctionId) {
  const auction = await getAuctionById(auctionId);
  if (!auction) {
    return;
  }

  const db = getDb();
  await db.run(
    `UPDATE assets
     SET start_at = ?,
         end_at = ?,
         status = CASE
           WHEN ? = 'open' AND status != 'closed' THEN 'open'
           WHEN ? = 'closed' THEN 'closed'
           ELSE status
         END
     WHERE auction_id = ?`,
    auction.start_at,
    auction.end_at,
    auction.status,
    auction.status,
    auctionId
  );

  const assets = await db.all("SELECT id FROM assets WHERE auction_id = ?", auctionId);
  await Promise.all(assets.map((asset) => broadcastAssetUpdate(asset.id)));
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
  startAuctionSweep();
  httpServer.listen(PORT, () => {
    console.log(`Auction platform running on http://localhost:${PORT}`);
  });
}

function assetRoomName(assetId) {
  return `asset:${assetId}`;
}

async function broadcastAuctionUpdate(auctionId) {
  const db = getDb();
  const auction = await db.get(
    `SELECT id, title AS name, description, start_at, end_at, status,
            (SELECT COUNT(*) FROM assets x WHERE x.auction_id = auctions.id) AS asset_count
     FROM auctions
     WHERE id = ?`,
    auctionId
  );
  if (!auction) {
    return;
  }

  const phase = deriveAuctionPhase(auction);
  const payload = {
    auctionId: auction.id,
    name: auction.name,
    description: auction.description,
    status: auction.status,
    phase,
    startAt: auction.start_at,
    endAt: auction.end_at,
    assetCount: Number(auction.asset_count) || 0,
    serverTime: new Date().toISOString()
  };

  io.emit("auction:update", payload);
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
