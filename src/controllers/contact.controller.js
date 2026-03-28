const db = require('../config/database');

// ─── SEND MESSAGE ─────────────────────────────────────────────────

const sendContact = async (req, res) => {
  try {
    const { listingId } = req.params;
    const { name, phone, email, message } = req.body;

    if (!phone && !email) {
      return res.status(400).json({ error: 'ტელეფონი ან Email სავალდებულოა' });
    }

    const listing = await db.query(
      'SELECT id, user_id FROM listings WHERE id = $1 AND status = $2',
      [listingId, 'active']
    );
    if (listing.rows.length === 0) {
      return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    }

    const senderId = req.user?.id || null;

    const result = await db.query(
      `INSERT INTO contacts (listing_id, sender_id, name, phone, email, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [listingId, senderId, name || null, phone || null, email || null, message || null]
    );

    // Increment contacts count
    await db.query(
      'UPDATE listings SET contacts_count = contacts_count + 1 WHERE id = $1',
      [listingId]
    );

    return res.status(201).json({
      message: 'შეტყობინება გაიგზავნა',
      id: result.rows[0].id,
    });
  } catch (err) {
    console.error('sendContact error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── GET INBOX (listing owner) ────────────────────────────────────

const getInbox = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const unreadOnly = req.query.unread === 'true';

    const conditions = ['l.user_id = $1'];
    const values = [userId];
    let idx = 2;

    if (unreadOnly) {
      conditions.push(`c.is_read = false`);
    }

    const result = await db.query(
      `SELECT c.id, c.name, c.phone, c.email, c.message,
              c.is_read, c.created_at,
              l.id AS listing_id, l.title_ka, l.title_en, l.slug,
              (SELECT url FROM listing_media
               WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS listing_cover
       FROM contacts c
       JOIN listings l ON l.id = c.listing_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    const total = await db.query(
      `SELECT COUNT(*) FROM contacts c
       JOIN listings l ON l.id = c.listing_id
       WHERE l.user_id = $1`,
      [userId]
    );

    const unreadCount = await db.query(
      `SELECT COUNT(*) FROM contacts c
       JOIN listings l ON l.id = c.listing_id
       WHERE l.user_id = $1 AND c.is_read = false`,
      [userId]
    );

    return res.json({
      data: result.rows,
      unread: parseInt(unreadCount.rows[0].count),
      pagination: {
        page, limit,
        total: parseInt(total.rows[0].count),
        pages: Math.ceil(total.rows[0].count / limit),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── MARK AS READ ─────────────────────────────────────────────────

const markAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { contactId } = req.params;

    // Verify ownership via listing
    const result = await db.query(
      `UPDATE contacts c SET is_read = true
       FROM listings l
       WHERE c.listing_id = l.id
         AND l.user_id = $1
         AND c.id = $2
       RETURNING c.id`,
      [userId, contactId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'შეტყობინება ვერ მოიძებნა' });
    }

    return res.json({ message: 'წაკითხულია' });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── MARK ALL READ ────────────────────────────────────────────────

const markAllRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await db.query(
      `UPDATE contacts c SET is_read = true
       FROM listings l
       WHERE c.listing_id = l.id AND l.user_id = $1`,
      [userId]
    );

    return res.json({ message: 'ყველა წაკითხულია' });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

module.exports = { sendContact, getInbox, markAsRead, markAllRead };
