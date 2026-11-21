import { MongoClient } from "mongodb";

let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    dbPromise = client
      .connect()
      .then(async (c) => {
        const db = c.db(process.env.DB_NAME || "pizzahub");
        await Promise.all([
          db.collection("menuItems").createIndex({ status: 1, category: 1 }),
          db.collection("menuItems").createIndex({ vendorId: 1 }),
          db.collection("orders").createIndex({ customerId: 1 }),
          db.collection("orders").createIndex({ vendorId: 1 }),
          db.collection("reviews").createIndex({ itemId: 1, customerId: 1 }, { unique: true, partialFilterExpression: { reviewType: "item" } }),
          db.collection("reviews").createIndex({ vendorId: 1, customerId: 1 }, { unique: true, partialFilterExpression: { reviewType: "restaurant" } }),
          db.collection("transactions").createIndex({ stripeSessionId: 1 }, { unique: true }),
        ]);
        return db;
      })
      .catch((err) => {
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

export async function col(name) {
  return (await getDb()).collection(name);
}
