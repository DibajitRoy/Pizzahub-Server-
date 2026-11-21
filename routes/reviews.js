import { Router } from "express";
import { col } from "../config/db.js";
import { optionalAuth, requireRole, verifyJWT } from "../middleware/auth.js";
import { HttpError, requireObjectId } from "../utils/helpers.js";

const router = Router();
router.get("/restaurant/:vendorId", optionalAuth, async (req, res) => {
  const vendorId = requireObjectId(req.params.vendorId, "restaurant ID");
  const [users, reviews] = await Promise.all([col("users"), col("reviews")]);
  if (!(await users.findOne({ _id: vendorId, role: "vendor" }))) throw new HttpError(404, "Restaurant not found");
  const items = await reviews.aggregate([
    { $match: { vendorId, reviewType: "restaurant" } }, { $sort: { createdAt: -1 } },
    { $lookup: { from: "users", localField: "customerId", foreignField: "_id", as: "customer", pipeline: [{ $project: { name: 1 } }] } },
    { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
  ]).toArray();
  const average = items.length ? Math.round(items.reduce((sum, r) => sum + r.rating, 0) / items.length * 10) / 10 : 0;
  res.json({ items, average, count: items.length });
});

router.post("/restaurant/:vendorId", verifyJWT, requireRole("customer"), async (req, res) => {
  const vendorId = requireObjectId(req.params.vendorId, "restaurant ID");
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Rating must be from 1 to 5");
  if (comment.length < 3 || comment.length > 1000) throw new HttpError(400, "Review must be 3-1000 characters");
  const [users, orders, reviews] = await Promise.all([col("users"), col("orders"), col("reviews")]);
  if (!(await users.findOne({ _id: vendorId, role: "vendor" }))) throw new HttpError(404, "Restaurant not found");
  if (!(await orders.findOne({ vendorId, customerId: req.user._id, status: "accepted" }))) throw new HttpError(403, "You can review a restaurant after an accepted order");
  const doc = { vendorId, reviewType: "restaurant", customerId: req.user._id, rating, comment, createdAt: new Date() };
  try { const result = await reviews.insertOne(doc); res.status(201).json({ ...doc, _id: result.insertedId }); }
  catch (error) { if (error.code === 11000) throw new HttpError(409, "You have already reviewed this restaurant"); throw error; }
});

router.get("/:itemId", optionalAuth, async (req, res) => {
  const itemId = requireObjectId(req.params.itemId, "item ID");
  const [menu, reviews] = await Promise.all([col("menuItems"), col("reviews")]);
  if (!(await menu.findOne({ _id: itemId, status: "approved" }))) throw new HttpError(404, "Menu item not found");
  const items = await reviews.aggregate([
    { $match: { itemId, reviewType: { $ne: "restaurant" } } }, { $sort: { createdAt: -1 } },
    { $lookup: { from: "users", localField: "customerId", foreignField: "_id", as: "customer", pipeline: [{ $project: { name: 1 } }] } },
    { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
  ]).toArray();
  const average = items.length ? Math.round(items.reduce((sum, r) => sum + r.rating, 0) / items.length * 10) / 10 : 0;
  res.json({ items, average, count: items.length });
});

router.post("/:itemId", verifyJWT, requireRole("customer"), async (req, res) => {
  const itemId = requireObjectId(req.params.itemId, "item ID");
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Rating must be from 1 to 5");
  if (comment.length < 3 || comment.length > 1000) throw new HttpError(400, "Review must be 3-1000 characters");
  const [menu, orders, reviews] = await Promise.all([col("menuItems"), col("orders"), col("reviews")]);
  if (!(await menu.findOne({ _id: itemId, status: "approved" }))) throw new HttpError(404, "Menu item not found");
  if (!(await orders.findOne({ itemId, customerId: req.user._id, status: "accepted" }))) throw new HttpError(403, "You can review an item after your order is accepted");
  const doc = { itemId, vendorId: item.vendorId, reviewType: "item", customerId: req.user._id, rating, comment, createdAt: new Date() };
  try { const result = await reviews.insertOne(doc); res.status(201).json({ ...doc, _id: result.insertedId }); }
  catch (error) { if (error.code === 11000) throw new HttpError(409, "You have already reviewed this item"); throw error; }
});
export default router;
