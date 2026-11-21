import { Router } from "express";
import { col } from "../config/db.js";
import { optionalAuth } from "../middleware/auth.js";
import { CATEGORIES, HttpError, escapeRegex, paging, requireObjectId, vendorStages } from "../utils/helpers.js";

const router = Router();
const notBlocked = { $match: { "vendor.isBlocked": { $ne: true } } };

// GET /api/menu?search=&category=&location=&sort=price_asc|price_desc|newest&page=&limit=
router.get("/", async (req, res) => {
  const { search = "", category = "", location = "", sort = "newest" } = req.query;
  const { page, limit, skip } = paging(req.query, 9, 24);
  const match = { status: "approved" };
  if (CATEGORIES.includes(category)) match.category = category;
  if (location) match.location = { $regex: escapeRegex(String(location).slice(0, 60)), $options: "i" };
  if (search) {
    const rx = { $regex: escapeRegex(String(search).slice(0, 60)), $options: "i" };
    match.$or = [{ itemName: rx }, { description: rx }, { category: rx }, { location: rx }];
  }
  const sortMap = {
    price_asc: { price: 1, _id: 1 },
    price_desc: { price: -1, _id: 1 },
    newest: { createdAt: -1, _id: 1 },
  };
  const menu = await col("menuItems");
  const [result] = await menu
    .aggregate([
      { $match: match },
      ...vendorStages,
      notBlocked,
      { $sort: sortMap[sort] || sortMap.newest },
      { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: "n" }] } },
    ])
    .toArray();
  const total = result.total[0]?.n || 0;
  res.json({ items: result.items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// Premium vendors' items are shown first
router.get("/featured", async (req, res) => {
  const limit = Math.min(12, Math.max(1, parseInt(req.query.limit) || 6));
  const menu = await col("menuItems");
  const items = await menu
    .aggregate([
      { $match: { status: "approved" } },
      ...vendorStages,
      notBlocked,
      { $sort: { "vendor.isPremium": -1, createdAt: -1 } },
      { $limit: limit },
    ])
    .toArray();
  res.json({ items });
});

router.get("/locations", async (req, res) => {
  const menu = await col("menuItems");
  const locations = await menu.distinct("location", { status: "approved" });
  res.json({ locations: locations.sort() });
});

router.get("/:id", optionalAuth, async (req, res) => {
  const _id = requireObjectId(req.params.id, "item ID");
  const menu = await col("menuItems");
  const [item] = await menu.aggregate([{ $match: { _id } }, ...vendorStages]).toArray();
  if (!item) throw new HttpError(404, "Item not found");
  const isOwner = req.user && String(item.vendorId) === String(req.user._id);
  const isAdmin = req.user?.role === "admin";
  if ((item.status !== "approved" || item.vendor.isBlocked) && !isOwner && !isAdmin)
    throw new HttpError(404, "This item is not available");
  res.json(item);
});

export default router;