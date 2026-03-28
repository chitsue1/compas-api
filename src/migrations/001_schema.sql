-- =============================================
-- PROPTECH GE — Full Database Schema
-- Run: psql -U postgres -d proptech_db -f schema.sql
-- =============================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- =============================================
-- ENUMS
-- =============================================

CREATE TYPE user_role AS ENUM ('user', 'agent', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'banned', 'pending');

CREATE TYPE deal_type AS ENUM ('sale', 'rent', 'daily_rent');
CREATE TYPE property_type AS ENUM ('apartment', 'house', 'commercial', 'land', 'hotel', 'garage');
CREATE TYPE listing_status AS ENUM ('draft', 'pending', 'active', 'rejected', 'sold', 'rented', 'expired');
CREATE TYPE listing_condition AS ENUM ('new', 'renovated', 'old', 'under_construction', 'black_frame', 'white_frame', 'green_frame');

CREATE TYPE payment_status AS ENUM ('pending', 'success', 'failed', 'refunded');
CREATE TYPE plan_type AS ENUM ('free', 'standard', 'premium', 'vip');

-- =============================================
-- LOCATIONS
-- =============================================

CREATE TABLE cities (
  id        SERIAL PRIMARY KEY,
  name_ka   VARCHAR(100) NOT NULL,
  name_en   VARCHAR(100) NOT NULL,
  slug      VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE districts (
  id        SERIAL PRIMARY KEY,
  city_id   INTEGER REFERENCES cities(id) ON DELETE CASCADE,
  name_ka   VARCHAR(100) NOT NULL,
  name_en   VARCHAR(100) NOT NULL,
  slug      VARCHAR(100) NOT NULL,
  UNIQUE(city_id, slug)
);

CREATE TABLE streets (
  id          SERIAL PRIMARY KEY,
  district_id INTEGER REFERENCES districts(id) ON DELETE CASCADE,
  name_ka     VARCHAR(200),
  name_en     VARCHAR(200)
);

-- =============================================
-- USERS
-- =============================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  phone         VARCHAR(20) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name    VARCHAR(100),
  last_name     VARCHAR(100),
  avatar_url    VARCHAR(500),
  role          user_role NOT NULL DEFAULT 'user',
  status        user_status NOT NULL DEFAULT 'active',
  is_verified   BOOLEAN DEFAULT FALSE,
  agency_name   VARCHAR(200),
  agency_logo   VARCHAR(500),
  about         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- =============================================
-- LISTINGS
-- =============================================

CREATE TABLE listings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Type & Deal
  deal_type       deal_type NOT NULL,
  property_type   property_type NOT NULL,
  status          listing_status NOT NULL DEFAULT 'pending',
  plan            plan_type NOT NULL DEFAULT 'free',

  -- Location
  city_id         INTEGER REFERENCES cities(id),
  district_id     INTEGER REFERENCES districts(id),
  street_id       INTEGER REFERENCES streets(id),
  address_detail  VARCHAR(300),
  latitude        DECIMAL(10, 8),
  longitude       DECIMAL(11, 8),

  -- Price
  price           DECIMAL(15, 2) NOT NULL,
  price_currency  CHAR(3) DEFAULT 'USD',
  price_per_m2    DECIMAL(10, 2),
  negotiable      BOOLEAN DEFAULT FALSE,

  -- Details
  area_total      DECIMAL(8, 2),
  area_living     DECIMAL(8, 2),
  area_kitchen    DECIMAL(8, 2),
  floor           SMALLINT,
  floors_total    SMALLINT,
  rooms           SMALLINT,
  bedrooms        SMALLINT,
  bathrooms       SMALLINT,
  condition       listing_condition,

  -- Description
  title_ka        VARCHAR(300),
  title_en        VARCHAR(300),
  description_ka  TEXT,
  description_en  TEXT,

  -- 3D / Media
  tour_3d_url     VARCHAR(500),
  video_url       VARCHAR(500),

  -- SEO & Meta
  slug            VARCHAR(400) UNIQUE,
  views_count     INTEGER DEFAULT 0,
  contacts_count  INTEGER DEFAULT 0,

  -- Boost
  is_boosted      BOOLEAN DEFAULT FALSE,
  boosted_until   TIMESTAMPTZ,
  is_vip          BOOLEAN DEFAULT FALSE,
  vip_until       TIMESTAMPTZ,

  -- Timestamps
  published_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for search performance
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_deal_type ON listings(deal_type);
CREATE INDEX idx_listings_property_type ON listings(property_type);
CREATE INDEX idx_listings_city ON listings(city_id);
CREATE INDEX idx_listings_district ON listings(district_id);
CREATE INDEX idx_listings_price ON listings(price);
CREATE INDEX idx_listings_rooms ON listings(rooms);
CREATE INDEX idx_listings_user ON listings(user_id);
CREATE INDEX idx_listings_boosted ON listings(is_boosted, boosted_until);
CREATE INDEX idx_listings_location ON listings(latitude, longitude);

-- Full-text search
ALTER TABLE listings ADD COLUMN search_vector tsvector;
CREATE INDEX idx_listings_fts ON listings USING gin(search_vector);

-- =============================================
-- LISTING MEDIA
-- =============================================

CREATE TABLE listing_media (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE,
  url         VARCHAR(500) NOT NULL,
  url_thumb   VARCHAR(500),
  url_medium  VARCHAR(500),
  order_index SMALLINT DEFAULT 0,
  is_cover    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_media_listing ON listing_media(listing_id);

-- =============================================
-- LISTING FEATURES
-- =============================================

CREATE TABLE features (
  id      SERIAL PRIMARY KEY,
  name_ka VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  icon    VARCHAR(50),
  category VARCHAR(50)  -- 'comfort', 'security', 'infrastructure'
);

CREATE TABLE listing_features (
  listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE,
  feature_id  INTEGER REFERENCES features(id) ON DELETE CASCADE,
  PRIMARY KEY (listing_id, feature_id)
);

-- =============================================
-- FAVORITES
-- =============================================

CREATE TABLE favorites (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, listing_id)
);

-- =============================================
-- CONTACTS / MESSAGES
-- =============================================

CREATE TABLE contacts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE,
  sender_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  name        VARCHAR(200),
  phone       VARCHAR(20),
  email       VARCHAR(255),
  message     TEXT,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contacts_listing ON contacts(listing_id);

-- =============================================
-- PAYMENTS & SUBSCRIPTIONS
-- =============================================

CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  listing_id      UUID REFERENCES listings(id) ON DELETE SET NULL,
  amount          DECIMAL(10, 2) NOT NULL,
  currency        CHAR(3) DEFAULT 'GEL',
  plan            plan_type,
  status          payment_status DEFAULT 'pending',
  provider        VARCHAR(50),   -- 'bog', 'tbc', 'card'
  provider_ref    VARCHAR(200),
  meta            JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- SEED DATA — Cities & Districts
-- =============================================

INSERT INTO cities (name_ka, name_en, slug) VALUES
  ('თბილისი', 'Tbilisi', 'tbilisi'),
  ('ბათუმი', 'Batumi', 'batumi'),
  ('ქუთაისი', 'Kutaisi', 'kutaisi'),
  ('რუსთავი', 'Rustavi', 'rustavi'),
  ('გორი', 'Gori', 'gori');

INSERT INTO districts (city_id, name_ka, name_en, slug) VALUES
  (1, 'საბურთალო', 'Saburtalo', 'saburtalo'),
  (1, 'ვაკე', 'Vake', 'vake'),
  (1, 'ისანი', 'Isani', 'isani'),
  (1, 'სამგორი', 'Samgori', 'samgori'),
  (1, 'ნაძალადევი', 'Nadzaladevi', 'nadzaladevi'),
  (1, 'გლდანი', 'Gldani', 'gldani'),
  (1, 'დიდუბე', 'Didube', 'didube'),
  (1, 'კრწანისი', 'Krtsanisi', 'krtsanisi'),
  (1, 'მთაწმინდა', 'Mtatsminda', 'mtatsminda'),
  (1, 'ჩუღურეთი', 'Chughureti', 'chughureti'),
  (2, 'ცენტრი', 'Center', 'center'),
  (2, 'ახალი ბულვარი', 'New Boulevard', 'new-boulevard'),
  (2, 'ჩაქვი', 'Chakvi', 'chakvi');

INSERT INTO features (name_ka, name_en, icon, category) VALUES
  ('პარკინგი', 'Parking', 'parking', 'infrastructure'),
  ('ლიფტი', 'Elevator', 'elevator', 'infrastructure'),
  ('ბალკონი', 'Balcony', 'balcony', 'comfort'),
  ('საწყობი', 'Storage', 'storage', 'comfort'),
  ('ბუნებრივი გაზი', 'Natural Gas', 'gas', 'infrastructure'),
  ('ცენტრალური გათბობა', 'Central Heating', 'heating', 'infrastructure'),
  ('კონდიციონერი', 'Air Conditioning', 'ac', 'comfort'),
  ('ინტერნეტი', 'Internet', 'wifi', 'comfort'),
  ('ვიდეო მეთვალყურეობა', 'CCTV', 'cctv', 'security'),
  ('დაცული ეზო', 'Secured Yard', 'security', 'security'),
  ('აუზი', 'Swimming Pool', 'pool', 'comfort'),
  ('ტერასა', 'Terrace', 'terrace', 'comfort'),
  ('ევრო რემონტი', 'Euro Renovation', 'renovation', 'comfort'),
  ('ავეჯი', 'Furnished', 'furniture', 'comfort'),
  ('ტექნიკა', 'Appliances', 'appliances', 'comfort');
