# foodpanda-cli

CLI for ordering food from foodpanda.ph — designed for AI assistants that don't support MCP.

All commands output structured JSON to stdout.

## Setup

```bash
npm install -g foodpanda-cli
# or
npx foodpanda-cli
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FOODPANDA_LATITUDE` | Yes | Delivery address latitude |
| `FOODPANDA_LONGITUDE` | Yes | Delivery address longitude |
| `FOODPANDA_SESSION_TOKEN` | No | Session token (fallback; use `login` command instead) |

### Login

```bash
foodpanda-cli login
```

Opens a browser window to foodpanda.ph. Log in manually — the token is captured automatically and saved to `~/.foodpanda-cli/token.json`.

## Commands

### Search & Discovery

```bash
# Search restaurants
foodpanda-cli search "jollibee" --cuisine "Filipino" --limit 5

# List chain outlets
foodpanda-cli outlets <chain_code>

# Get restaurant details
foodpanda-cli restaurant <vendor_code>
```

### Menu

```bash
# Get restaurant menu (compact)
foodpanda-cli menu <vendor_code>

# Get item details with toppings
foodpanda-cli item <vendor_code> <product_code>
```

### Cart

```bash
# Add items to cart
foodpanda-cli add <vendor_code> --items '[{"item_id":"ct-36-pd-1673","quantity":2}]'

# View cart
foodpanda-cli cart

# Remove item
foodpanda-cli remove <cart_item_id>
```

### Order

```bash
# Preview order (delivery address, payment methods, totals)
foodpanda-cli preview

# Place order (only COD works)
foodpanda-cli order --payment payment_on_delivery --instructions "Leave at door"
```

## For AI Assistants

This CLI is designed to be invoked by AI assistants as shell commands. All output is JSON.

**Ordering workflow:**
1. `search` -> find restaurants
2. `menu` -> browse items
3. `item` -> check toppings/variations
4. `add` -> build cart
5. `preview` -> review order
6. `order` -> place order (only after user confirmation)

**Limitations:**
- Only `payment_on_delivery` (Cash on Delivery) works
- Philippines only (foodpanda.ph)
- Session tokens expire; use `login` to refresh
