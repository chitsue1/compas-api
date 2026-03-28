const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// ─── PLAN PRICING ─────────────────────────────────────────────────

const PLANS = {
  standard: { price: 5,  currency: 'GEL', days: 30,  label: 'სტანდარტი' },
  premium:  { price: 15, currency: 'GEL', days: 30,  label: 'პრემიუმ' },
  vip:      { price: 25, currency: 'GEL', days: 30,  label: 'VIP' },
  boost_7:  { price: 3,  currency: 'GEL', days: 7,   label: 'ბუსტი 7 დღე' },
  boost_14: { price: 5,  currency: 'GEL', days: 14,  label: 'ბუსტი 14 დღე' },
};

// ─── GET PLANS ────────────────────────────────────────────────────

const getPlans = async (req, res) => {
  return res.json(PLANS);
};

// ─── INITIATE PAYMENT ─────────────────────────────────────────────
// Creates a pending payment record and returns payment intent.
// Actual provider (BOG/TBC) integration goes in the TODO block.

const initiatePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { listing_id, plan_key, provider = 'bog' } = req.body;

    if (!listing_id || !plan_key) {
      return res.status(400).json({ error: 'listing_id და plan_key სავალდებულოა' });
    }

    const plan = PLANS[plan_key];
    if (!plan) {
      return res.status(400).json({ error: 'პლანი ვერ მოიძებნა' });
    }

    // Verify listing ownership
    const listing = await db.query(
      'SELECT id, user_id FROM listings WHERE id = $1',
      [listing_id]
    );
    if (listing.rows.length === 0) {
      return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    }
    if (listing.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'წვდომა შეზღუდულია' });
    }

    const paymentId = uuidv4();

    // Create pending payment
    await db.query(
      `INSERT INTO payments (id, user_id, listing_id, amount, currency, plan, status, provider, meta)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
      [
        paymentId, userId, listing_id,
        plan.price, plan.currency,
        plan_key, provider,
        JSON.stringify({ plan_label: plan.label, days: plan.days }),
      ]
    );

    // TODO: Integrate BOG Pay or TBC Pay here.
    // BOG Pay docs: https://developer.bog.ge
    // TBC Pay docs: https://developers.tbcbank.ge
    //
    // Example flow:
    // 1. Call provider API with amount, currency, orderId=paymentId, callbackUrl
    // 2. Provider returns redirect URL
    // 3. Return redirect URL to frontend
    // 4. User completes payment on provider page
    // 5. Provider calls our webhook (see confirmPayment below)

    return res.status(201).json({
      payment_id: paymentId,
      amount: plan.price,
      currency: plan.currency,
      plan: plan.label,
      // redirect_url: providerRedirectUrl  ← will be added with BOG/TBC integration
      message: 'გადახდის სისტემა მალე დაემატება (BOG Pay / TBC Pay)',
    });
  } catch (err) {
    console.error('initiatePayment error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── CONFIRM PAYMENT (webhook from BOG/TBC) ───────────────────────

const confirmPayment = async (req, res) => {
  try {
    const { payment_id, provider_ref, status } = req.body;

    // TODO: Validate webhook signature from provider

    if (!payment_id) {
      return res.status(400).json({ error: 'payment_id სავალდებულოა' });
    }

    const payment = await db.query(
      'SELECT * FROM payments WHERE id = $1',
      [payment_id]
    );
    if (payment.rows.length === 0) {
      return res.status(404).json({ error: 'გადახდა ვერ მოიძებნა' });
    }

    const p = payment.rows[0];

    if (status === 'success') {
      // Update payment
      await db.query(
        `UPDATE payments SET status = 'success', provider_ref = $1, updated_at = NOW()
         WHERE id = $2`,
        [provider_ref || null, payment_id]
      );

      // Apply plan to listing
      const plan = PLANS[p.plan];
      const until = new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000);

      if (p.plan.startsWith('boost')) {
        await db.query(
          `UPDATE listings SET is_boosted = true, boosted_until = $1,
                               plan = 'standard', updated_at = NOW()
           WHERE id = $2`,
          [until, p.listing_id]
        );
      } else if (p.plan === 'vip') {
        await db.query(
          `UPDATE listings SET is_vip = true, vip_until = $1,
                               plan = 'vip', updated_at = NOW()
           WHERE id = $2`,
          [until, p.listing_id]
        );
      } else if (p.plan === 'premium') {
        await db.query(
          `UPDATE listings SET plan = 'premium', updated_at = NOW() WHERE id = $1`,
          [p.listing_id]
        );
      } else if (p.plan === 'standard') {
        await db.query(
          `UPDATE listings SET plan = 'standard', status = 'active',
                               published_at = NOW(),
                               expires_at = $1, updated_at = NOW()
           WHERE id = $2`,
          [until, p.listing_id]
        );
      }
    } else {
      await db.query(
        `UPDATE payments SET status = 'failed', provider_ref = $1, updated_at = NOW()
         WHERE id = $2`,
        [provider_ref || null, payment_id]
      );
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('confirmPayment error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── PAYMENT HISTORY ──────────────────────────────────────────────

const getHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT p.id, p.amount, p.currency, p.plan, p.status,
              p.provider, p.created_at,
              l.title_ka, l.title_en, l.slug
       FROM payments p
       LEFT JOIN listings l ON l.id = p.listing_id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [userId]
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

module.exports = { getPlans, initiatePayment, confirmPayment, getHistory };
