import { Router } from "express";
import { col } from "../config/db.js";
import { verifyJWT } from "../middleware/auth.js";
import { HttpError, effectivePlan } from "../utils/helpers.js";

const router = Router();
router.use(verifyJWT);

router.get("/me", (req, res) => {
  const u = req.user;
  res.json({
    id: String(u._id),
    name: u.name,
    email: u.email,
    image: u.image,
    role: u.role,
    businessName: u.businessName,
    subscriptionPlan: effectivePlan(u),
    subscriptionExpiresAt: u.subscriptionExpiresAt,
  });
});


router.post("/me/select-role", async (req, res) => {
  const { role, businessName } = req.body || {};
  if (!["vendor", "customer"].includes(role)) throw new HttpError(400, "Role must be vendor or customer");
  const set = { role, roleSelected: true };
  if (role === "vendor" && typeof businessName === "string" && businessName.trim())
    set.businessName = businessName.trim().slice(0, 80);
  const users = await col("users");
  const r = await users.updateOne(
    { _id: req.user._id, roleSelected: { $ne: true }, role: { $ne: "admin" } },
    { $set: set }
  );
  if (!r.matchedCount) throw new HttpError(403, "Role has already been selected");
  res.json({ message: "Role saved", role });
});

export default router;