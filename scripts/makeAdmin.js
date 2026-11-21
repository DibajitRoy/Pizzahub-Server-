import "dotenv/config";
import { MongoClient } from "mongodb";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run make-admin -- admin@example.com");
  process.exit(1);
}
const client = new MongoClient(process.env.MONGODB_URI);
try {
  await client.connect();
  const users = client.db(process.env.DB_NAME || "pizzahub").collection("users");
  const r = await users.updateOne({ email: email.toLowerCase() }, { $set: { role: "admin", roleSelected: true, isBlocked: false } });
  console.log(r.matchedCount ? `✅ ${email} is now an admin` : "❌ No user with that email. Sign up on the website first.");
} finally {
  await client.close();
}