import { Router } from "express";
import { col } from "../config/db.js";
import { requireRole, verifyJWT } from "../middleware/auth.js";
import { deleteItemCascade } from "../utils/cascade.js";
import {
  ACTIVE_STATUSES,
  FREE_ITEM_LIMIT,
  HttpError,
  effectivePlan,
  isPremium,
  requireObjectId,
  validateItem,
} from "../utils/helpers.js";

const router = Router();
router.use(verifyJWT, requireRole("vendor"));

const upgradeError = () =>
  new HttpError(403, "Free plan allows up to 3 active menu items. Upgrade to Premium to add more.", "UPGRADE_REQUIRED");

const countActive = async (vendorId) =>
  (await col("menuItems")).countDocuments({ vendorId, status: { $in: ACTIVE_STATUSES } });

async function ownItem(req) {
  const _id = requireObjectId(req.params.id, "item ID");
  const item = await (await col("menuItems")).findOne({ _id });
  if (!item) throw new HttpError(404, "Item not found");
  if (String(item.vendorId) !== String(req.user._id)) throw new HttpError(403, "You do not own this item");
  return item;
}

router.get("/overview", async (req, res) => {
  const vendorId = req.user._id;
  const [menu, orders] = await Promise.all([col("menuItems"), col("orders")]);
  const group = [{ $match: { vendorId } }, { $group: { _id: "$status", count: { $sum: 1 } } }];
  const [items, ords] = await Promise.all([menu.aggregate(group).toArray(), orders.aggregate(group).toArray()]);
  const toMap = (a) => Object.fromEntries(a.map((x) => [x._id, x.count]));
  const im = toMap(items);
  const om = toMap(ords);
  res.json({
    totalItems: Object.values(im).reduce((a, b) => a + b, 0),
    activeItems: im.approved || 0,
    pendingOrders: om.pending || 0,
    acceptedOrders: om.accepted || 0,
    plan: effectivePlan(req.user),
    itemsByStatus: im,
    ordersByStatus: om,
  });
});

router.get("/menu", async (req, res) => {
  const menu = await col("menuItems");
  const items = await menu.find({ vendorId: req.user._id }).sort({ createdAt: -1 }).toArray();
  res.json({ items });
});

router.get("/menu/:id", async (req, res) => res.json(await ownItem(req)));

router.post("/menu", async (req, res) => {
  const data = validateItem(req.body);
  if (!isPremium(req.user) && (await countActive(req.user._id)) >= FREE_ITEM_LIMIT) throw upgradeError();
  const menu = await col("menuItems");
  const doc = { ...data, vendorId: req.user._id, status: "pending", createdAt: new Date(), updatedAt: new Date() };
  const r = await menu.insertOne(doc);
  res.status(201).json({ ...doc, _id: r.insertedId });
});

router.patch("/menu/:id", async (req, res) => {
  const item = await ownItem(req);
  const data = validateItem(req.body);
  const set = { ...data, updatedAt: new Date() };
  let resubmitted = false;
  if (["approved", "rejected"].includes(item.status)) {
    if (item.status === "rejected" && !isPremium(req.user) && (await countActive(req.user._id)) >= FREE_ITEM_LIMIT)
      throw upgradeError();
    set.status = "pending"; // edited items go back for admin review
    resubmitted = true;
  }
  await (await col("menuItems")).updateOne({ _id: item._id }, { $set: set });
  res.json({ message: resubmitted ? "Item updated and sent for re-review" : "Item updated" });
});

// Manage availability: approved <-> inactive (only if the vendor deactivated it)
router.patch("/menu/:id/availability", async (req, res) => {
  const item = await ownItem(req);
  const { available } = req.body;
  if (typeof available !== "boolean") throw new HttpError(400, "available must be true or false");
  const menu = await col("menuItems");
  if (!available) {
    if (item.status !== "approved") throw new HttpError(400, "Only approved items can be deactivated");
    await menu.updateOne({ _id: item._id }, { $set: { status: "inactive", inactiveBy: "vendor", updatedAt: new Date() } });
    return res.json({ message: "Item deactivated", status: "inactive" });
  }
  if (item.status !== "inactive" || item.inactiveBy !== "vendor")
    throw new HttpError(400, "This item cannot be reactivated by you");
  if (!isPremium(req.user) && (await countActive(req.user._id)) >= FREE_ITEM_LIMIT) throw upgradeError();
  await menu.updateOne({ _id: item._id }, { $set: { status: "approved", updatedAt: new Date() }, $unset: { inactiveBy: "" } });
  res.json({ message: "Item is available again", status: "approved" });
});

router.delete("/menu/:id", async (req, res) => {
  const item = await ownItem(req);
  await deleteItemCascade(item._id);
  res.json({ message: "Item deleted" });
});

router.get("/orders", async (req, res) => {
  const orders = await col("orders");
  const list = await orders
    .aggregate([
      { $match: { vendorId: req.user._id } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "customerId",
          foreignField: "_id",
          as: "customer",
          pipeline: [{ $project: { name: 1, email: 1, image: 1 } }],
        },
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
    ])
    .toArray();
  res.json({ items: list });
});


router.patch("/orders/:id/status", async (req, res) => {
  const _id = requireObjectId(req.params.id, "order ID");
  const { status } = req.body;
  if (!["accepted", "rejected"].includes(status)) throw new HttpError(400, "Status must be accepted or rejected");
  const orders = await col("orders");
  const order = await orders.findOne({ _id });
  if (!order) throw new HttpError(404, "Order not found");
  if (String(order.vendorId) !== String(req.user._id)) throw new HttpError(403, "This order does not belong to you");
  const updated = await orders.findOneAndUpdate(
    { _id, vendorId: req.user._id, status: "pending" },
    { $set: { status, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!updated) throw new HttpError(400, "Only pending orders can be accepted or rejected");
  res.json({ message: `Order ${status}`, order: updated });
});

router.get("/transactions", async (req, res) => {
  const tx = await col("transactions");
  res.json({ items: await tx.find({ vendorId: req.user._id }).sort({ createdAt: -1 }).toArray() });
});

export default router;