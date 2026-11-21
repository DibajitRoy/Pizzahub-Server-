# PizzaHub API Server

Express API for the PizzaHub ordering platform. It uses MongoDB for menu items, orders, transactions, and Better Auth users; JWTs are verified against the Better Auth JWKS endpoint.

## Local development

Requires Node.js and npm. From this folder:

```bash
npm install
npm run dev
```

The API listens on `http://localhost:5000` unless `PORT` is set. Run the Next.js client in a separate terminal. Its `.env` should set `NEXT_PUBLIC_API_URL=http://localhost:5000/api`.

## Environment variables

Create `.env` locally. Never commit `.env` or real credentials.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `DB_NAME` | No | Business database name; defaults to `pizzahub` |
| `AUTH_URL` | Yes in production | Better Auth base URL used for JWKS, issuer, and audience verification; use `http://localhost:3000` locally |
| `CLIENT_URL` | Yes | Allowed client origins, comma separated; first origin is used for payment redirects |
| `PORT` | No | API port; defaults to `5000` |
| `STRIPE_SECRET_KEY` | For Premium | Stripe secret key; server only |
| `STRIPE_WEBHOOK_SECRET` | For Premium | Webhook signing secret; server only |
| `PREMIUM_PRICE_CENTS` | No | Monthly price in cents; defaults to `999` |

## Main API areas

- `/api/menu`: approved menu browsing, locations, featured items, and item details.
- `/api/vendor`: vendor overview, own menu items, orders, and subscription endpoints.
- `/api/orders`: customer order creation, history, overview, and pending-order cancellation.
- `/api/favorites`: customer favorites.
- `/api/users`: current user and initial role selection.
- `/api/admin`: admin dashboard, users, menu review, and read-only transactions.
- `/api/payments`: vendor Premium checkout, cancellation, and subscription status.
- `/webhook/stripe`: signed Stripe webhook receiver; raw-body parsing is configured before JSON middleware.

Menu query parameters: `search`, `category`, `location`, `sort`, `page`, and `limit`. Supported sorts are `newest`, `price_asc`, and `price_desc`.

## Security behavior

- Protected API routes verify JWT signature, issuer, audience, expiry, and the MongoDB user record before role checks.
- Admin, vendor, and customer routes enforce their role on the server. Vendor item/order updates and customer order cancellation check ownership.
- Public sign up cannot grant the admin role. Create the user on the client first, then run:

  ```bash
  npm run make-admin -- admin@example.com
  ```

- Premium status changes only after a validated Stripe webhook event. Never enable Premium from a success-page redirect.
- Configure `AUTH_URL` to the same origin used by Better Auth, and include the exact deployed frontend origin(s) in `CLIENT_URL`.

For local Stripe testing, forward `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, and `customer.subscription.deleted` to `/webhook/stripe` with the Stripe CLI.

## Deployment and submission

- Live API URL: not deployed yet
- Server repository: not published yet
- Client repository: not published yet

Set production environment variables in the hosting provider, use HTTPS origins, configure the Stripe webhook endpoint and secret, and verify the health response at `/`. Publish separate client and server repositories before submitting.
