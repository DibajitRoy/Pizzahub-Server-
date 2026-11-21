import { ObjectId } from "mongodb";

export const CATEGORIES = [
  "Classic Pizzas",
  "Vegetarian Pizzas",
  "Meat Lovers",
  "Specialty / Gourmet Pizzas",
  "Sides & Appetizers",
  "Beverages & Desserts",
];
export const FREE_ITEM_LIMIT = 3;
export const ACTIVE_STATUSES = ["approved"];

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const toObjectId = (id) =>
  typeof id === "string" && /^[a-f\d]{24}$/i.test(id) ? new ObjectId(id) : null;

export const requireObjectId = (id, label = "ID") => {
  const oid = toObjectId(id);
  if (!oid) throw new HttpError(400, `Invalid ${label}`);
  return oid;
};

// Better Auth user ids may be ObjectId or string depending on config
export const userIdQuery = (id) => {
  const oid = toObjectId(String(id));
  return oid ? { $or: [{ _id: oid }, { _id: String(id) }] } : { _id: String(id) };
};

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isPremium = (u) =>
  !!(u && u.subscriptionPlan === "premium" && u.subscriptionExpiresAt && new Date(u.subscriptionExpiresAt) > new Date());

export const effectivePlan = (u) => (isPremium(u) ? "premium" : "free");

export const paging = (q, defLimit = 10, max = 50) => {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(q.limit) || defLimit));
  return { page, limit, skip: (page - 1) * limit };
};

export const vendorStages = [
  {
    $lookup: {
      from: "users",
      localField: "vendorId",
      foreignField: "_id",
      as: "vendor",
      pipeline: [
        { $project: { name: 1, businessName: 1, image: 1, subscriptionPlan: 1, subscriptionExpiresAt: 1, isBlocked: 1 } },
      ],
    },
  },
  { $unwind: "$vendor" },
  {
    $addFields: {
      "vendor.isPremium": {
        $and: [
          { $eq: ["$vendor.subscriptionPlan", "premium"] },
          { $gt: ["$vendor.subscriptionExpiresAt", "$$NOW"] },
        ],
      },
    },
  },
];

export function validateItem(b = {}) {
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const itemName = s(b.itemName);
  const category = s(b.category);
  const description = s(b.description);
  const location = s(b.location);
  const price = Number(b.price);
  const images = Array.isArray(b.images) ? b.images.filter((u) => typeof u === "string") : [];

  if (itemName.length < 2 || itemName.length > 80) throw new HttpError(400, "Item name must be 2-80 characters");
  if (!CATEGORIES.includes(category)) throw new HttpError(400, "Invalid category");
  if (description.length < 10 || description.length > 1000)
    throw new HttpError(400, "Description must be 10-1000 characters");
  if (!Number.isFinite(price) || price <= 0 || price > 10000)
    throw new HttpError(400, "Price must be a number greater than 0");
  if (location.length < 2 || location.length > 80) throw new HttpError(400, "Location must be 2-80 characters");
  if (images.length < 1 || images.length > 4) throw new HttpError(400, "Upload 1 to 4 images");
  for (const u of images) {
    let ok = false;
    try {
      const url = new URL(u);
      ok = url.protocol === "https:" && url.hostname.includes("ibb.co");
    } catch {}
    if (!ok) throw new HttpError(400, "Images must be uploaded through ImgBB");
  }
  return { itemName, category, description, price: Math.round(price * 100) / 100, location, images };
}