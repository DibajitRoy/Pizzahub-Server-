#  PizzaHub API Server

Express API for PizzaHub. It uses MongoDB for menu items, orders, transactions, and Better Auth users. JWTs are verified against the Better Auth JWKS endpoint.

## Local Development

Requires Node.js, npm, and MongoDB.

```bash
npm install
npm run dev
```

The API listens on `http://localhost:5000` unless `PORT` is set.

Run the Next.js client separately and set this in its `.env`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

## Environment Variables

Create a local `.env` file. **Never commit secrets or production credentials.**

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `DB_NAME` | No | Business database name; defaults to `pizzahub` |
| `AUTH_URL` | Yes in production | Better Auth URL used for JWT verification; use `http://localhost:3000` locally |
| `CLIENT_URL` | Yes | Allowed frontend origins, comma separated; first origin is used for payment redirects |
| `PORT` | No | API port; defaults to `5000` |
| `STRIPE_SECRET_KEY` | For Premium | Stripe secret key; server only |
| `STRIPE_WEBHOOK_SECRET` | For Premium | Stripe webhook signing secret; server only |
| `PREMIUM_PRICE_CENTS` | No | Monthly Premium price in cents; defaults to `999` |

## Main API Routes

- `/api/menu` — approved menu browsing, locations, featured items, and item details
- `/api/vendor` — vendor overview, menu items, orders, and subscriptions
- `/api/orders` — customer orders, history, overview, and pending-order cancellation
- `/api/favorites` — customer favorites
- `/api/users` — current user and initial role selection
- `/api/admin` — admin dashboard, users, menu review, and transactions
- `/api/payments` — Premium checkout, cancellation, and subscription status
- `/webhook/stripe` — Stripe webhook receiver

**Menu query parameters:** `search`, `category`, `location`, `sort`, `page`, and `limit`.

**Supported sort values:** `newest`, `price_asc`, and `price_desc`.

## Admin Account Setup

Public registration cannot create admin accounts. Create an account through the client first, then run this command from the server project:

```bash
npm run make-admin -- admin@example.com
```

Replace `admin@example.com` with the account email. Sign in using the password chosen when creating the account. There is no default admin password.

## Security

- Protected routes verify JWT signature, issuer, audience, expiry, and the MongoDB user record.
- Admin, vendor, and customer permissions are enforced on the server.
- Vendor updates and customer order cancellations check resource ownership.
- Premium status changes only after a validated Stripe webhook. Never activate Premium from a browser redirect.
- Set `AUTH_URL` to the Better Auth origin and include the deployed frontend origin in `CLIENT_URL`.

## Project Links

- **Live Client:** [PizzaHub](https://pizzahub-client-alpha-wine.vercel.app/)
- **Client Repository:** [Pizzahub-Client-](https://github.com/DibajitRoy/Pizzahub-Client-)
