import { col } from "../config/db.js";

export async function deleteItemCascade(itemId) {
  const [menu, orders, users] = await Promise.all([col("menuItems"), col("orders"), col("users")]);
  await menu.deleteOne({ _id: itemId });
  await orders.updateMany(
    { itemId, status: "pending" },
    { $set: { status: "rejected", updatedAt: new Date() } }
  );
  await users.updateMany({ favorites: itemId }, { $pull: { favorites: itemId } });
}