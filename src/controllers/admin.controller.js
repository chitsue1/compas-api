const db = require('../config/database');

// ─── DASHBOARD STATS ──────────────────────────────────────────────

const getStats = async (req, res) => {
  try {
    const [listings, users, contacts, revenue] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')  AS active,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
          COUNT(*) AS total
        FROM listings
      `),
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE role = 'agent') AS agents,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS new_this_month
        FROM users
      `),
      db.query(`SELECT COUNT(*) AS total FROM contacts`),
      db.query(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM payments WHERE status = 'success'
      `),
    ]);

    return res.json({
      listings: listings.rows[0],
      users:    users.rows[0],
      contacts: contacts.rows[0],
      revenue:  revenue.rows[0],
    });
  } catch (err) {
    console.error('getStats error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── LIST ALL LISTINGS (with filters) ────────────────────────────

const adminGetListings = async (req, res) => {
  try {
    const {
      status, deal_type, property_type,
      city_id, user_id,
      page = 1, limit = 30,
    } = req.query;

    const conditions = [];
    const values = [];
    let idx = 1;

    if (status)        { conditions.push(`l.status = $${idx++}`);        values.push(status); }
    if (deal_type)     { conditions.push(`l.deal_type = $${idx++}`);     values.push(deal_type); }
    if (property_type) { conditions.push(`l.property_type = $${idx++}`); values.push(property_type); }
    if (city_id)       { conditions.push(`l.city_id = $${idx++}`);       values.push(parseInt(city_id)); }
    if (user_id)       { conditions.push(`l.user_id = $${idx++}`);       values.push(user_id); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await db.query(
      `SELECT l.id, l.slug, l.deal_type, l.property_type, l.status, l.plan,
              l.price, l.price_currency, l.area_total, l.rooms,
              l.title_ka, l.title_en,
              l.views_count, l.contacts_count,
              l.is_boosted, l.is_vip,
              l.created_at, l.published_at,
              c.name_ka AS city_ka,
              u.email AS user_email, u.first_name, u.last_name, u.role AS user_role,
              (SELECT url FROM listing_media
               WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_url
       FROM listings l
       LEFT JOIN cities c ON l.city_id = c.id
       LEFT JOIN users u ON l.user_id = u.id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, parseInt(limit), offset]
    );

    const total = await db.query(
      `SELECT COUNT(*) FROM listings l ${where}`, values
    );

    return res.json({
      data: result.rows,
      pagination: {
        page: parseInt(page), limit: parseInt(limit),
        total: parseInt(total.rows[0].count),
        pages: Math.ceil(total.rows[0].count / parseInt(limit)),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── APPROVE LISTING ──────────────────────────────────────────────

const approveListing = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE listings
       SET status = 'active', published_at = NOW(),
           expires_at = NOW() + INTERVAL '30 days',
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, published_at`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    return res.json({ message: 'განცხადება დამტკიცდა', listing: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── REJECT LISTING ───────────────────────────────────────────────

const rejectListing = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const result = await db.query(
      `UPDATE listings SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 RETURNING id, status`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    // TODO: notify user via email with reason
    return res.json({ message: 'განცხადება უარყოფილია', reason });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── SET BOOST / VIP ──────────────────────────────────────────────

const setBoost = async (req, res) => {
  try {
    const { id } = req.params;
    const { days = 7, type = 'boost' } = req.body; // type: 'boost' | 'vip'

    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const field = type === 'vip'
      ? `is_vip = true, vip_until = $1`
      : `is_boosted = true, boosted_until = $1`;

    const result = await db.query(
      `UPDATE listings SET ${field}, updated_at = NOW()
       WHERE id = $2 RETURNING id, is_boosted, boosted_until, is_vip, vip_until`,
      [until, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    return res.json({ message: `${type} ჩართულია ${days} დღით`, listing: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── REMOVE BOOST / VIP ───────────────────────────────────────────

const removeBoost = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      `UPDATE listings
       SET is_boosted = false, boosted_until = NULL,
           is_vip = false, vip_until = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
    return res.json({ message: 'Boost/VIP გათიშულია' });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── LIST ALL USERS ───────────────────────────────────────────────

const adminGetUsers = async (req, res) => {
  try {
    const { role, status, page = 1, limit = 30 } = req.query;

    const conditions = [];
    const values = [];
    let idx = 1;

    if (role)   { conditions.push(`role = $${idx++}`);   values.push(role); }
    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await db.query(
      `SELECT id, email, phone, first_name, last_name,
              role, status, is_verified, agency_name, created_at,
              (SELECT COUNT(*) FROM listings WHERE user_id = users.id) AS listing_count
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, parseInt(limit), offset]
    );

    const total = await db.query(`SELECT COUNT(*) FROM users ${where}`, values);

    return res.json({
      data: result.rows,
      pagination: {
        page: parseInt(page), limit: parseInt(limit),
        total: parseInt(total.rows[0].count),
        pages: Math.ceil(total.rows[0].count / parseInt(limit)),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── BAN / UNBAN USER ─────────────────────────────────────────────

const setUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'active' | 'banned'

    if (!['active', 'banned'].includes(status)) {
      return res.status(400).json({ error: 'სტატუსი: active ან banned' });
    }

    // Prevent banning self
    if (id === req.user.id) {
      return res.status(400).json({ error: 'საკუთარი ანგარიში ვერ დაიბლოკება' });
    }

    const result = await db.query(
      `UPDATE users SET status = $1, updated_at = NOW()
       WHERE id = $2 AND role != 'admin'
       RETURNING id, email, status`,
      [status, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });
    return res.json({ message: `სტატუსი შეიცვალა: ${status}`, user: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── VERIFY USER (agent badge) ────────────────────────────────────

const verifyUser = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE users SET is_verified = true, updated_at = NOW()
       WHERE id = $1 RETURNING id, email, is_verified`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });
    return res.json({ message: 'მომხმარებელი ვერიფიცირებულია', user: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── PAYMENTS LIST ────────────────────────────────────────────────

const adminGetPayments = async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const conditions = status ? [`p.status = $1`] : [];
    const values = status ? [status] : [];
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const idx = values.length + 1;

    const result = await db.query(
      `SELECT p.*, u.email AS user_email,
              l.title_ka AS listing_title
       FROM payments p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN listings l ON l.id = p.listing_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, parseInt(limit), offset]
    );

    return res.json({ data: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

module.exports = {
  getStats,
  adminGetListings, approveListing, rejectListing,
  setBoost, removeBoost,
  adminGetUsers, setUserStatus, verifyUser,
  adminGetPayments,
};
