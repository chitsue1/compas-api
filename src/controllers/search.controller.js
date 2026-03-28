const db = require('../config/database');

// ─── MAIN SEARCH ──────────────────────────────────────────────────

const search = async (req, res) => {
  try {
    const {
      deal_type,
      property_type,
      city_id,
      district_id,
      price_min,
      price_max,
      area_min,
      area_max,
      rooms,
      bedrooms,
      floor_min,
      floor_max,
      condition,
      features,       // comma-separated feature IDs
      q,              // full-text search
      sort = 'newest',
      page = 1,
      limit = 20,
      currency = 'USD',
    } = req.query;

    const conditions = [`l.status = 'active'`];
    const values = [];
    let idx = 1;

    if (deal_type) {
      conditions.push(`l.deal_type = $${idx++}`);
      values.push(deal_type);
    }
    if (property_type) {
      const types = property_type.split(',');
      conditions.push(`l.property_type = ANY($${idx++}::property_type[])`);
      values.push(types);
    }
    if (city_id) {
      conditions.push(`l.city_id = $${idx++}`);
      values.push(parseInt(city_id));
    }
    if (district_id) {
      const ids = district_id.split(',').map(Number);
      conditions.push(`l.district_id = ANY($${idx++}::int[])`);
      values.push(ids);
    }
    if (price_min) {
      conditions.push(`l.price >= $${idx++}`);
      values.push(parseFloat(price_min));
    }
    if (price_max) {
      conditions.push(`l.price <= $${idx++}`);
      values.push(parseFloat(price_max));
    }
    if (area_min) {
      conditions.push(`l.area_total >= $${idx++}`);
      values.push(parseFloat(area_min));
    }
    if (area_max) {
      conditions.push(`l.area_total <= $${idx++}`);
      values.push(parseFloat(area_max));
    }
    if (rooms) {
      const roomList = rooms.split(',').map(Number);
      conditions.push(`l.rooms = ANY($${idx++}::int[])`);
      values.push(roomList);
    }
    if (bedrooms) {
      conditions.push(`l.bedrooms = $${idx++}`);
      values.push(parseInt(bedrooms));
    }
    if (floor_min) {
      conditions.push(`l.floor >= $${idx++}`);
      values.push(parseInt(floor_min));
    }
    if (floor_max) {
      conditions.push(`l.floor <= $${idx++}`);
      values.push(parseInt(floor_max));
    }
    if (condition) {
      conditions.push(`l.condition = $${idx++}`);
      values.push(condition);
    }
    if (q) {
      conditions.push(
        `l.search_vector @@ to_tsquery('simple', $${idx++})`
      );
      values.push(q.split(' ').join(' & '));
    }
    if (features) {
      const featureIds = features.split(',').map(Number);
      conditions.push(
        `EXISTS (
          SELECT 1 FROM listing_features lf2
          WHERE lf2.listing_id = l.id
          AND lf2.feature_id = ANY($${idx++}::int[])
        )`
      );
      values.push(featureIds);
    }

    const whereClause = conditions.join(' AND ');

    // Sort
    const sortMap = {
      newest:    'l.is_vip DESC, l.is_boosted DESC, l.published_at DESC',
      oldest:    'l.published_at ASC',
      price_asc: 'l.price ASC',
      price_desc:'l.price DESC',
      area_asc:  'l.area_total ASC',
      area_desc: 'l.area_total DESC',
    };
    const orderBy = sortMap[sort] || sortMap.newest;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM listings l WHERE ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);

    // Main query
    const listingsResult = await db.query(
      `SELECT
        l.id, l.slug, l.deal_type, l.property_type, l.status,
        l.price, l.price_currency, l.price_per_m2, l.negotiable,
        l.area_total, l.rooms, l.floor, l.floors_total,
        l.condition, l.title_ka, l.title_en,
        l.latitude, l.longitude,
        l.tour_3d_url,
        l.views_count, l.is_boosted, l.is_vip, l.published_at,
        c.name_ka AS city_ka, c.name_en AS city_en,
        d.name_ka AS district_ka, d.name_en AS district_en,
        (SELECT url FROM listing_media
         WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_url,
        (SELECT COUNT(*) FROM listing_media WHERE listing_id = l.id) AS photo_count
       FROM listings l
       LEFT JOIN cities c ON l.city_id = c.id
       LEFT JOIN districts d ON l.district_id = d.id
       WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limitNum, offset]
    );

    return res.json({
      data: listingsResult.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('search error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── MAP ENDPOINT ─────────────────────────────────────────────────

const getMapListings = async (req, res) => {
  try {
    const { deal_type, property_type, city_id, price_min, price_max } = req.query;

    const conditions = [`l.status = 'active'`, `l.latitude IS NOT NULL`, `l.longitude IS NOT NULL`];
    const values = [];
    let idx = 1;

    if (deal_type) { conditions.push(`l.deal_type = $${idx++}`); values.push(deal_type); }
    if (property_type) { conditions.push(`l.property_type = $${idx++}`); values.push(property_type); }
    if (city_id) { conditions.push(`l.city_id = $${idx++}`); values.push(parseInt(city_id)); }
    if (price_min) { conditions.push(`l.price >= $${idx++}`); values.push(parseFloat(price_min)); }
    if (price_max) { conditions.push(`l.price <= $${idx++}`); values.push(parseFloat(price_max)); }

    const result = await db.query(
      `SELECT
        l.id, l.slug, l.deal_type, l.property_type,
        l.price, l.price_currency, l.rooms, l.area_total,
        l.latitude, l.longitude, l.title_ka, l.title_en,
        (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_url
       FROM listings l
       WHERE ${conditions.join(' AND ')}
       LIMIT 500`,
      values
    );

    // Return as GeoJSON
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)],
        },
        properties: {
          id: row.id,
          slug: row.slug,
          deal_type: row.deal_type,
          property_type: row.property_type,
          price: row.price,
          currency: row.price_currency,
          rooms: row.rooms,
          area: row.area_total,
          title_ka: row.title_ka,
          title_en: row.title_en,
          cover_url: row.cover_url,
        },
      })),
    };

    return res.json(geojson);
  } catch (err) {
    console.error('getMapListings error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── SIMILAR LISTINGS ─────────────────────────────────────────────

const getSimilar = async (req, res) => {
  try {
    const { id } = req.params;

    const base = await db.query(
      'SELECT deal_type, property_type, city_id, price FROM listings WHERE id = $1',
      [id]
    );
    if (base.rows.length === 0) return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });

    const { deal_type, property_type, city_id, price } = base.rows[0];
    const priceRange = parseFloat(price) * 0.3;

    const result = await db.query(
      `SELECT l.id, l.slug, l.deal_type, l.property_type,
              l.price, l.price_currency, l.rooms, l.area_total,
              l.title_ka, l.title_en,
              c.name_ka AS city_ka, d.name_ka AS district_ka,
              (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_url
       FROM listings l
       LEFT JOIN cities c ON l.city_id = c.id
       LEFT JOIN districts d ON l.district_id = d.id
       WHERE l.id != $1
         AND l.status = 'active'
         AND l.deal_type = $2
         AND l.property_type = $3
         AND l.city_id = $4
         AND l.price BETWEEN $5 AND $6
       ORDER BY l.is_boosted DESC, l.published_at DESC
       LIMIT 6`,
      [id, deal_type, property_type, city_id,
       parseFloat(price) - priceRange, parseFloat(price) + priceRange]
    );

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

module.exports = { search, getMapListings, getSimilar };
