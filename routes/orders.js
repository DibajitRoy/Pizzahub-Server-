import { Router } from "express";
import { col } from "../config/db.js";
import { requireRole, verifyJWT } from "../middleware/auth.js";
import { HttpError, requireObjectId } from "../utils/helpers.js";

const router = Router();
router.use(verifyJWT, requireRole("customer"));

router.post("/", async (req, res) => {
  const { itemId, deliveryDate, deliveryAddress, message } = req.body || {};
  const _id = requireObjectId(itemId, "item ID");

  const date = typeof deliveryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ? deliveryDate : null;
  if (!date || Number.isNaN(new Date(date).getTime())) throw new HttpError(400, "A valid delivery date is required");
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (date < yesterday) throw new HttpError(400, "Delivery date cannot be in the past");

  const address = typeof deliveryAddress === "string" ? deliveryAddress.trim() : "";
  if (address.length < 5 || address.length > 200) throw new HttpError(400, "Delivery address must be 5-200 characters");
  const note = typeof message === "string" ? message.trim().slice(0, 500) : "";

  const [menu, users, orders] = await Promise.all([col("menuItems"), col("users"), col("orders")]);
  const item = await menu.findOne({ _id, status: "approved" });
  if (!item) throw new HttpError(404, "This item is not available for ordering");
  const vendor = await users.findOne({ _id: item.vendorId });
  if (!vendor || vendor.isBlocked) throw new HttpError(404, "This item is not available for ordering");
  if (String(item.vendorId) === String(req.user._id)) throw new HttpError(403, "You cannot order your own item");

  const dup = await orders.findOne({
    itemId: _id,
    customerId: req.user._id,
    deliveryDate: date,
    status: { $in: ["pending", "accepted"] },
  });
  if (dup) throw new HttpError(409, "You already have an active order for this item on that date");

  const doc = {
    itemId: _id,
    vendorId: item.vendorId,
    customerId: req.user._id,
    deliveryDate: date,
    deliveryAddress: address,
    message: note,
    status: "pending",
    item: { itemName: item.itemName, image: item.images[0], price: item.price, category: item.category },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const r = await orders.insertOne(doc);
  res.status(201).json({ message: "Order placed successfully", order: { ...doc, _id: r.insertedId } });
});

router.get("/my", async (req, res) => {
  const orders = await col("orders");
  const items = await orders
    .aggregate([
      { $match: { customerId: req.user._id } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "vendorId",
          foreignField: "_id",
          as: "vendor",
          pipeline: [{ $project: { name: 1, businessName: 1, email: 1, image: 1 } }],
        },
      },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
    ])
    .toArray();
  res.json({ items });
});

router.get("/overview", async (req, res) => {
  const orders = await col("orders");
  const g = await orders
    .aggregate([{ $match: { customerId: req.user._id } }, { $group: { _id: "$status", count: { $sum: 1 } } }])
    .toArray();
  const m = Object.fromEntries(g.map((x) => [x._id, x.count]));
  res.json({
    total: Object.values(m).reduce((a, b) => a + b, 0),
    pending: m.pending || 0,
    accepted: m.accepted || 0,
    rejected: m.rejected || 0,
    cancelled: m.cancelled || 0,
  });
});

router.patch("/:id/cancel", async (req, res) => {
  const _id = requireObjectId(req.params.id, "order ID");
  const orders = await col("orders");
  const order = await orders.findOne({ _id });
  if (!order) throw new HttpError(404, "Order not found");
  if (String(order.customerId) !== String(req.user._id)) throw new HttpError(403, "This order does not belong to you");
  const updated = await orders.findOneAndUpdate(
    { _id, customerId: req.user._id, status: "pending" },
    { $set: { status: "cancelled", updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!updated) throw new HttpError(400, `A ${order.status} order cannot be cancelled`);
  res.json({ message: "Order cancelled" });
});

export default router;