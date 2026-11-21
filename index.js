import "dotenv/config";
import express from "express";
import cors from "cors";
import menuRoutes from "./routes/menu.js";
import vendorRoutes from "./routes/vendor.js";
import orderRoutes from "./routes/orders.js";
import favoriteRoutes from "./routes/favorites.js";
import userRoutes from "./routes/users.js";
import adminRoutes from "./routes/admin.js";
import paymentRoutes, { stripeWebhook } from "./routes/payments.js";
import reviewRoutes from "./routes/reviews.js";
import { HttpError } from "./utils/helpers.js";

const app = express();

const allowed = (process.env.CLIENT_URL || "")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new HttpError(403, "Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Stripe needs the RAW body, so this must come before express.json()
app.post("/webhook/stripe", express.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => res.json({ name: "PizzaHub API", status: "ok" }));

app.use("/api/menu", menuRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);

app.use((req, res) => res.status(404).json({ message: "Route not found" }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ message: "Invalid JSON body" });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    message: status >= 500 ? "Internal server error" : err.message,
    ...(err.code ? { code: err.code } : {}),
  });
});

const PORT = process.env.PORT || 5000;
if (!process.env.VERCEL) app.listen(PORT, () => console.log(`PizzaHub API running on port ${PORT}`));

export default app;
