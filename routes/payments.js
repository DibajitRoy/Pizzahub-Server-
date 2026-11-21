import { Router } from "express";
import Stripe from "stripe";
import { col } from "../config/db.js";
import { requireRole, verifyJWT } from "../middleware/auth.js";
import { ACTIVE_STATUSES, FREE_ITEM_LIMIT, HttpError, effectivePlan, isPremium, userIdQuery } from "../utils/helpers.js";

let stripe;
const getStripe = () => (stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY));

const periodEnd = (sub) => {
  const ts = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000) : new Date(Date.now() + 31 * 24 * 3600 * 1000);
};

const router = Router();
router.use(verifyJWT, requireRole("vendor"));

// The vendor is ALWAYS taken from the verified token, never from the request body
router.post("/checkout", async (req, res) => {
  const user = req.user;
  if (isPremium(user)) throw new HttpError(400, "You already have an active Premium plan");
  const base = (process.env.CLIENT_URL || "").split(",")[0].trim().replace(/\/$/, "");
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Number(process.env.PREMIUM_PRICE_CENTS) || 999,
          recurring: { interval: "month" },
          product_data: { name: "PizzaHub Premium", description: "Unlimited menu items, Premium badge & featured placement" },
        },
        quantity: 1,
      },
    ],
    ...(user.stripeCustomerId ? { customer: user.stripeCustomerId } : { customer_email: user.email }),
    client_reference_id: String(user._id),
    metadata: { vendorId: String(user._id) },
    subscription_data: { metadata: { vendorId: String(user._id) } },
    success_url: `${base}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/payment/cancel`,
  });
  res.json({ url: session.url });
});

// Read-only status. Used by the success page to wait for the webhook.
router.get("/status", async (req, res) => {
  const activeItems = await (await col("menuItems")).countDocuments({
    vendorId: req.user._id,
    status: { $in: ACTIVE_STATUSES },
  });
  res.json({
    plan: effectivePlan(req.user),
    expiresAt: req.user.subscriptionExpiresAt || null,
    cancelAtPeriodEnd: !!req.user.subscriptionCancelAtPeriodEnd,
    activeItems,
    limit: isPremium(req.user) ? null : FREE_ITEM_LIMIT,
  });
});

// Cancels at period end; Stripe then fires customer.subscription.deleted
router.post("/cancel", async (req, res) => {
  const subId = req.user.stripeSubscriptionId;
  if (!isPremium(req.user) || !subId) throw new HttpError(400, "No active subscription to cancel");
  await getStripe().subscriptions.update(subId, { cancel_at_period_end: true });
  await (await col("users")).updateOne({ _id: req.user._id }, { $set: { subscriptionCancelAtPeriodEnd: true } });
  res.json({ message: "Subscription will end at the end of the current billing period" });
});

export default router;

// ---------- Webhook (raw body; mounted in index.js BEFORE express.json) ----------
export async function stripeWebhook(req, res) {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    await handleEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler failed:", err);
    res.status(500).json({ received: false });
  }
}

async function handleEvent(event) {
  const users = await col("users");
  const transactions = await col("transactions");
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription" || obj.payment_status !== "paid") return;
      const vendorId = obj.metadata?.vendorId;
      if (!vendorId) return;
      const vendor = await users.findOne(userIdQuery(vendorId));
      if (!vendor || vendor.role !== "vendor") return;
      const sub = await getStripe().subscriptions.retrieve(obj.subscription);
      await users.updateOne(
        { _id: vendor._id },
        {
          $set: {
            subscriptionPlan: "premium",
            subscriptionExpiresAt: periodEnd(sub),
            subscriptionCancelAtPeriodEnd: false,
            stripeCustomerId: obj.customer,
            stripeSubscriptionId: obj.subscription,
          },
        }
      );
      await transactions.updateOne(
        { stripeSessionId: obj.id }, // idempotent
        {
          $setOnInsert: {
            vendorId: vendor._id,
            plan: "premium",
            amount: (obj.amount_total || 0) / 100,
            currency: obj.currency,
            stripeSessionId: obj.id,
            stripeSubscriptionId: obj.subscription,
            status: "paid",
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
      break;
    }
    case "invoice.paid": {
      if (obj.billing_reason !== "subscription_cycle") return; // renewals only
      const vendor = await users.findOne({ stripeCustomerId: obj.customer });
      if (!vendor?.stripeSubscriptionId) return;
      const sub = await getStripe().subscriptions.retrieve(vendor.stripeSubscriptionId);
      await users.updateOne(
        { _id: vendor._id },
        { $set: { subscriptionPlan: "premium", subscriptionExpiresAt: periodEnd(sub) } }
      );
      await transactions.updateOne(
        { stripeSessionId: obj.id },
        {
          $setOnInsert: {
            vendorId: vendor._id,
            plan: "premium",
            amount: (obj.amount_paid || 0) / 100,
            currency: obj.currency,
            stripeSessionId: obj.id, // invoice id for renewals
            stripeSubscriptionId: vendor.stripeSubscriptionId,
            status: "paid",
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
      break;
    }
    case "customer.subscription.updated": {
      const vendor = await users.findOne({ stripeCustomerId: obj.customer });
      if (!vendor) return;
      if (["active", "trialing"].includes(obj.status)) {
        await users.updateOne(
          { _id: vendor._id },
          { $set: { subscriptionExpiresAt: periodEnd(obj), subscriptionCancelAtPeriodEnd: !!obj.cancel_at_period_end } }
        );
      } else if (["canceled", "unpaid", "incomplete_expired"].includes(obj.status)) {
        await users.updateOne({ _id: vendor._id }, { $set: { subscriptionPlan: "free", subscriptionExpiresAt: new Date() } });
      }
      break;
    }
    case "customer.subscription.deleted": {
      const vendor = await users.findOne({ stripeCustomerId: obj.customer });
      if (!vendor) return;
      await users.updateOne(
        { _id: vendor._id },
        { $set: { subscriptionPlan: "free", subscriptionExpiresAt: new Date(), subscriptionCancelAtPeriodEnd: false } }
      );
      break;
    }
    default:
      break;
  }
}