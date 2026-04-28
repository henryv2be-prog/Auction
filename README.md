# Auction Platform

An online auction platform where:

- **Admins** sign in to add/manage assets to auction.
- **Users** register/login and place bids on listed assets.

## Features

- Session-based authentication (`admin` and `user` roles)
- Default seeded admin user on first startup
- Admin auction management:
  - create multiple auctions
  - add multiple assets per auction
  - close auctions
  - edit auctions/assets and manage media
- Public asset listing and detail pages
- User bidding with validation (bid must be greater than current price)
- User "My Bids" page
- SQLite-backed persistence
- Socket.IO real-time updates for bid and status changes
- Rand (ZAR) currency display throughout the UI
- Admin media uploads (images + videos) per auction item
- Public homepage grouped by auctions with featured assets

## Tech Stack

- Node.js + Express
- EJS templates
- SQLite (`sqlite3`, `sqlite`)
- `express-session` + `connect-sqlite3`
- `socket.io` for live bid broadcasts
- `multer` for media uploads
- `bcryptjs` for password hashing

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment template and adjust values:

```bash
cp .env.example .env
```

3. Start in development mode:

```bash
npm run dev
```

or production mode:

```bash
npm start
```

4. Open:

```text
http://localhost:3000
```

## Default Admin Account

When the database is initialized, an admin account is automatically seeded:

- Email: `admin@auction.local`
- Password: `admin123`

You can override this using environment variables in `.env`.

## Environment Variables

See `.env.example`:

- `PORT`
- `SESSION_SECRET`
- `DATA_DIR` (default `/tmp/auction-platform`)
- `DB_PATH`
- `SESSION_DB_PATH`
- `UPLOADS_DIR`
- `MAX_MEDIA_FILES`
- `MAX_MEDIA_FILE_MB`
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## Media uploads

- Admins can attach up to **8 files** when creating an auction item (default).
- Supported file types:
  - Images: `jpg`, `jpeg`, `png`, `webp`, `gif`
  - Videos: `mp4`, `webm`, `mov`, `m4v`
- Max upload size: **50MB per file**
- Uploaded media is stored under:
  - `<DATA_DIR>/uploads`
  - and served via `/uploads/...`

## Railway deployment notes

For Railway or similar container platforms:

1. Add a writable **Volume** (recommended path: `/data`)
2. Set:
   - `DATA_DIR=/data`
   - optionally `DB_PATH=/data/auction.db`
   - optionally `SESSION_DB_PATH=/data/sessions.sqlite`

The app now creates the data directory automatically at startup.
