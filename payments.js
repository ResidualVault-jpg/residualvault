const express = require('express');
const pool = require('./db');
const router = express.Router();

const getStripe = () => require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  starter_monthly: process.env.STRIPE_STARTER_MONTHLY,
  starter_yearly:  process.env.STRIPE_STARTER_YEARLY,
  pro_monthly:     process.env.STRIPE_PRO_MONTHLY,
  pro_yearly:      process.env.STRIPE_PRO_YEARLY,
  premium_monthly: process.env.STRIPE_PREMIUM_MONTHLY,
  premium_yearly:  process.env.STRIPE_PREMIUM_YEARLY,
};

router.post('/create-checkout', async (req, res) => {
  try {
    const stripe = getStripe();
    const { plan, email } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: PLANS[plan], quantity: 1 }],
      success_url: 'https://residualvault.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://residualvault.com/pricing',
    });
    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[Stripe] Checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe] Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  console.log('[Stripe] Webhook received:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email;
    const amount = session.amount_total;
    
    let plan = 'starter';
    if (amount >= 9900) plan = 'premium';
    else if (amount >= 2900) plan = 'pro';

    try {
      await pool.query('UPDATE users SET plan=$1 WHERE email=$2', [plan, email.toLowerCase()]);
      console.log(`[Stripe] Upgraded ${email} to ${plan}`);
    } catch (err) {
      console.error('[Stripe] Failed to upgrade user:', err.message);
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    try {
      const customer = await stripe.customers.retrieve(subscription.customer);
      const email = customer.email;
      const amount = subscription.items.data[0]?.price?.unit_amount || 0;
      
      let plan = 'starter';
      if (amount >= 9900) plan = 'premium';
      else if (amount >= 2900) plan = 'pro';

      await pool.query('UPDATE users SET plan=$1 WHERE email=$2', [plan, email.toLowerCase()]);
      console.log(`[Stripe] Updated ${email} to ${plan}`);
    } catch (err) {
      console.error('[Stripe] Failed to update user:', err.message);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    try {
      const customer = await stripe.customers.retrieve(subscription.customer);
      await pool.query('UPDATE users SET plan=$1 WHERE email=$2', ['free', customer.email.toLowerCase()]);
      console.log(`[Stripe] Downgraded ${customer.email} to free`);
    } catch (err) {
      console.error('[Stripe] Failed to downgrade user:', err.message);
    }
  }

  res.json({ received: true });
});

router.get('/plans', (req, res) => {
  res.json({
    starter: {
      name: 'Starter Plan',
      monthly: { price_id: PLANS.starter_monthly, amount: 3.69 },
      yearly: { price_id: PLANS.starter_yearly, amount: 36.76 }
    },
    pro: {
      name: 'Pro Plan',
      monthly: { price_id: PLANS.pro_monthly, amount: 9.99 },
      yearly: { price_id: PLANS.pro_yearly, amount: 99.51 }
    },
    premium: {
      name: 'Premium Plan',
      monthly: { price_id: PLANS.premium_monthly, amount: 19.99 },
      yearly: { price_id: PLANS.premium_yearly, amount: 199.10 }
    }
  });
});

module.exports = router;
