import { Router } from "express";
import { col } from "../config/db.js";
import { requireRole, verifyJWT } from "../middleware/auth.js";
import { deleteItemCascade } from "../utils/cascade.js";
import {
  CATEGORIES,
  HttpError,
  escapeRegex,
  paging,
  requireObjectId,
  userIdQuery,
  vendorStages,
} from "../utils/helpers.js";

const router = Router();
router.use(verifyJWT, requireRole("admin"));

router.get("/overview", async (req, res) => {
  const [users, menu, tx] = await Promise.all([col("users"), col("menuItems"), col("transactions")]);
  const [roles, items, totalTransactions, revenue, byMonth] = await Promise.all([
    users.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]).toArray(),
    menu.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
    tx.countDocuments(),
    tx.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
    tx
      .aggregate([
        { $match: { status: "paid" } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, amount: { $sum: "$amount" } } },
        { $sort: { _id: -1 } },
        { $limit: 6 },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
  ]);
  const rm = Object.fromEntries(roles.map((x) => [x._id, x.count]));
  const im = Object.fromEntries(items.map((x) => [x._id, x.count]));
  res.json({
    totalUsers: Object.values(rm).reduce((a, b) => a + b, 0),
    totalVendors: rm.vendor || 0,
    totalCustomers: rm.customer || 0,
    totalMenuItems: Object.values(im).reduce((a, b) => a + b, 0),
    pendingMenuItems: im.pending || 0,
    totalTransactions,
    totalRevenue: revenue[0]?.total || 0,
    itemsByStatus: im,
    usersByRole: rm,
    revenueByMonth: byMonth.map((m) => ({ month: m._id, amount: m.amount })),
  });
});

router.get("/users", async (req, res) => {
  const { search = "", role = "" } = req.query;
  const { page, limit, skip } = paging(req.query, 10);
  const filter = {};
  if (["vendor", "customer", "admin"].includes(role)) filter.role = role;
  if (search) {
    const rx = { $regex: escapeRegex(String(search).slice(0, 60)), $options: "i" };
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const users = await col("users");
  const [list, total] = await Promise.all([
    users
      .find(filter, {
        projection: { name: 1, email: 1, image: 1, role: 1, isBlocked: 1, businessName: 1, subscriptionPlan: 1, subscriptionExpiresAt: 1, createdAt: 1 },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    users.countDocuments(filter),
  ]);
  res.json({ items: list, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.patch("/users/:id/block", async (req, res) => {
  const { blocked } = req.body || {};
  if (typeof blocked !== "boolean") throw new HttpError(400, "blocked must be true or false");
  const users = await col("users");
  const target = await users.findOne(userIdQuery(req.params.id));
  if (!target) throw new HttpError(404, "User not found");
  if (target.role === "admin") throw new HttpError(403, "Admin accounts cannot be blocked");
  await users.updateOne({ _id: target._id }, { $set: { isBlocked: blocked } });
  if (blocked) {
    await (await col("session")).deleteMany({ userId: { $in: [target._id, String(target._id)] } });
  }
  res.json({ message: blocked ? "User blocked" : "User unblocked" });
});

router.get("/menu", async (req, res) => {
  const { search = "", status = "", category = "" } = req.query;
  const { page, limit, skip } = paging(req.query, 10);
  const match = {};
  if (["pending", "approved", "rejected", "inactive"].includes(status)) match.status = status;
  if (CATEGORIES.includes(category)) match.category = category;
  if (search) match.itemName = { $regex: escapeRegex(String(search).slice(0, 60)), $options: "i" };
  const menu = await col("menuItems");
  const [r] = await menu
    .aggregate([
      { $match: match },
      ...vendorStages,
      { $sort: { createdAt: -1 } },
      { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: "n" }] } },
    ])
    .toArray();
  const total = r.total[0]?.n || 0;
  res.json({ items: r.items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.patch("/menu/:id/status", async (req, res) => {
  const _id = requireObjectId(req.params.id, "item ID");
  const { status } = req.body || {};
  if (!["pending", "approved", "rejected", "inactive"].includes(status)) throw new HttpError(400, "Invalid status");
  const update = { $set: { status, updatedAt: new Date() } };
  if (status === "inactive") update.$set.inactiveBy = "admin";
  else update.$unset = { inactiveBy: "" };
  const r = await (await col("menuItems")).updateOne({ _id }, update);
  if (!r.matchedCount) throw new HttpError(404, "Item not found");
  res.json({ message: `Item marked ${status}` });
});

router.delete("/menu/:id", async (req, res) => {
  const _id = requireObjectId(req.params.id, "item ID");
  const item = await (await col("menuItems")).findOne({ _id });
  if (!item) throw new HttpError(404, "Item not found");
  await deleteItemCascade(_id);
  res.json({ message: "Item deleted" });
});


router.get("/transactions", async (req, res) => {
  const tx = await col("transactions");
  const items = await tx
    .aggregate([
      { $sort: { createdAt: -1 } },
      { $limit: 300 },
      {
        $lookup: {
          from: "users",
          localField: "vendorId",
          foreignField: "_id",
          as: "vendor",
          pipeline: [{ $project: { name: 1, email: 1, businessName: 1 } }],
        },
      },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
    ])
    .toArray();
  res.json({ items });
});

export default router;