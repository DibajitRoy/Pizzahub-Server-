import { Router } from "express";
import { col } from "../config/db.js";
import { requireRole, verifyJWT } from "../middleware/auth.js";
import { HttpError, requireObjectId, vendorStages } from "../utils/helpers.js";

const router = Router();
router.use(verifyJWT, requireRole("customer"));

router.get("/ids", (req, res) => res.json((req.user.favorites || []).map(String)));

router.get("/", async (req, res) => {
  const menu = await col("menuItems");
  const items = await menu
    .aggregate([
      { $match: { _id: { $in: req.user.favorites || [] }, status: "approved" } },
      ...vendorStages,
    ])
    .toArray();
  res.json({ items });
});

router.post("/:itemId", async (req, res) => {
  const _id = requireObjectId(req.params.itemId, "item ID");
  const item = await (await col("menuItems")).findOne({ _id, status: "approved" });
  if (!item) throw new HttpError(404, "Item not found");
  await (await col("users")).updateOne({ _id: req.user._id }, { $addToSet: { favorites: _id } });
  res.json({ message: "Added to favorites" });
});

router.delete("/:itemId", async (req, res) => {
  const _id = requireObjectId(req.params.itemId, "item ID");
  await (await col("users")).updateOne({ _id: req.user._id }, { $pull: { favorites: _id } });
  res.json({ message: "Removed from favorites" });
});

export default router;