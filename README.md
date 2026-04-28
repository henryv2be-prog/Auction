# Auction Platform

An online auction platform where:

- **Admins** sign in to add/manage assets to auction.
- **Users** register/login and place bids on listed assets.

## Features

- Session-based authentication (`admin` and `user` roles)
- Default seeded admin user on first startup
- Admin dashboard to create and close auction listings
- Public asset listing and detail pages
- User bidding with validation (bid must be greater than current price)
- User "My Bids" page
- SQLite-backed persistence

## Tech Stack

- Node.js + Express
- EJS templates
- SQLite (`sqlite3`, `sqlite`)
- `express-session` + `connect-sqlite3`
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
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## Railway deployment notes

For Railway or similar container platforms:

1. Add a writable **Volume** (recommended path: `/data`)
2. Set:
   - `DATA_DIR=/data`
   - optionally `DB_PATH=/data/auction.db`
   - optionally `SESSION_DB_PATH=/data/sessions.sqlite`

The app now creates the data directory automatically at startup.
