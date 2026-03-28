# PropTech GE — Backend API

Georgian Real Estate Platform — Node.js + Express + PostgreSQL

## Stack
- **Node.js / Express** — API server
- **PostgreSQL** — main database
- **Redis** — token blacklist + cache
- **Cloudflare R2 / AWS S3** — media storage

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Environment
```bash
cp .env.example .env
# შეავსე .env ფაილი შენი მონაცემებით
```

### 3. Database
```bash
# PostgreSQL-ში შექმენი database:
createdb proptech_db

# Migration გაუშვი:
npm run migrate
```

### 4. Run
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints — ეტაპი 1

### Auth
| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/auth/register | რეგისტრაცია |
| POST | /api/auth/login | შესვლა |
| POST | /api/auth/refresh | Token განახლება |
| POST | /api/auth/logout | გამოსვლა |
| GET  | /api/auth/me | ჩემი პროფილი |

### Health
| Method | URL | Description |
|--------|-----|-------------|
| GET | /health | სერვერის სტატუსი |

## Project Structure
```
src/
├── config/
│   ├── database.js     # PostgreSQL pool
│   └── redis.js        # Redis client
├── controllers/
│   └── auth.controller.js
├── middleware/
│   ├── auth.middleware.js    # JWT verify + role guard
│   ├── validate.middleware.js # Joi validation
│   └── error.middleware.js   # Rate limit + error handler
├── migrations/
│   ├── 001_schema.sql  # Full DB schema
│   └── run.js          # Migration runner
├── routes/
│   └── auth.routes.js
└── index.js            # App entry point
```

## Next Steps (ეტაპი 2)
- `src/controllers/listing.controller.js` — CRUD
- `src/routes/listing.routes.js`
- `src/config/s3.js` — Media upload
- `src/controllers/search.controller.js`
