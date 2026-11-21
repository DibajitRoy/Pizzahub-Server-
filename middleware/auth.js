import { createRemoteJWKSet, jwtVerify } from "jose";
import { col } from "../config/db.js";
import { HttpError, toObjectId } from "../utils/helpers.js";

let jwks;
const authUrl = () => (process.env.AUTH_URL || process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "");
const getJwks = () => (jwks ??= createRemoteJWKSet(new URL(`${authUrl()}/api/auth/jwks`)));

async function resolveUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) throw new HttpError(401, "Authentication required");

  let payload;
  try {
    ({ payload } = await jwtVerify(header.slice(7), getJwks(), {
      issuer: authUrl(),
      audience: authUrl(),
    }));
  } catch (err) {
    throw new HttpError(401, err?.code === "ERR_JWT_EXPIRED" ? "Token expired" : "Invalid token");
  }

  const sub = String(payload.sub || payload.id || "");
  if (!sub) throw new HttpError(401, "Invalid token");
  const users = await col("users");
  const oid = toObjectId(sub);
  const user = await users.findOne({ $or: [...(oid ? [{ _id: oid }] : []), { _id: sub }] });
  if (!user) throw new HttpError(401, "User not found");
  return user;
}

export async function verifyJWT(req, res, next) {
  const user = await resolveUser(req);
  if (user.isBlocked) throw new HttpError(403, "Your account has been blocked");
  req.user = user;
  next();
}

export async function optionalAuth(req, res, next) {
  if (req.headers.authorization) {
    try {
      const user = await resolveUser(req);
      if (!user.isBlocked) req.user = user;
    } catch {}
  }
  next();
}

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(new HttpError(401, "Authentication required"));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, "Forbidden: insufficient permissions"));
    next();
  };