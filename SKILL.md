---
name: foodpanda-pk-cli
description: >-
  Order food from foodpanda.pk using the foodpanda-pk-cli command-line tool.
  Use when the user wants to search restaurants, browse menus, build a cart,
  preview a food delivery order, or place a Cash on Delivery order in Pakistan.
  Requires Node.js and shell access.
compatibility: Requires Node.js 18+, npm, and shell access. Pakistan only (foodpanda.pk).
metadata:
  author: johnwhoyou
  version: "0.1.0"
---

# foodpanda-pk-cli

A command-line tool for browsing foodpanda Pakistan restaurants and building carts. All commands output structured JSON to stdout.

## Prerequisites and installation

Ensure Node.js 18+ and npm are available, then install dependencies and build:

```bash
npm install
npm run build
```

Optional global install:

```bash
npm install -g .
foodpanda-pk-cli --version
```

## Initial setup

Before using any other commands, complete these two setup steps.

### 1. Set delivery location

Provide the user's delivery coordinates in Pakistan:

```bash
foodpanda-pk-cli location <latitude> <longitude>
```

Multan example:

```bash
foodpanda-pk-cli location 30.2088719 71.4886923
```

### 2. Log in

Opens a browser window for the user to log in to foodpanda Pakistan. The session token is captured automatically.

```bash
foodpanda-pk-cli login
```

Optional timeout:

```bash
foodpanda-pk-cli login --timeout 180
```

Fallback:

```bash
$env:FOODPANDA_PK_SESSION_TOKEN = "your-session-token"
```

## Command reference

### Search and discovery

```bash
foodpanda-pk-cli search <query> [--cuisine <type>] [--limit <n>]
foodpanda-pk-cli outlets <chain_code>
foodpanda-pk-cli restaurant <vendor_code>
```

### Menu and items

```bash
foodpanda-pk-cli menu <vendor_code>
foodpanda-pk-cli item <vendor_code> <product_code>
```

### Cart management

```bash
foodpanda-pk-cli add <vendor_code> --items '<json_array>'
foodpanda-pk-cli add <vendor_code> --items-file .\items.json
foodpanda-pk-cli add <vendor_code> --item-id product-code --quantity 1
foodpanda-pk-cli cart
foodpanda-pk-cli remove <cart_item_id>
```

For Windows shells, prefer `--items-file` or single-item flags instead of hand-escaped JSON when possible.

### Saved addresses

```bash
foodpanda-pk-cli addresses
foodpanda-pk-cli address-use <address_id>
foodpanda-pk-cli address-auto
foodpanda-pk-cli address-current
```

Use `addresses` to list saved addresses, `address-use` to pin preview/order to one saved address and sync the CLI location to it, `address-auto` to return to nearest-address selection, and `address-current` to inspect the active address/location state.

### Preview

```bash
foodpanda-pk-cli preview
```

Preview requires a saved address in the foodpanda Pakistan account and returns a COD-oriented payment view.
If a saved-address override is active, preview and order use that address.

### Order

```bash
foodpanda-pk-cli order --payment payment_on_delivery --confirm
```

Live ordering is supported for Cash on Delivery after a successful preview.
`--confirm` is required because this places a real order.

## Recommended workflow

1. Set location
2. Log in
3. Search restaurants
4. Browse menu
5. Build cart
6. Optionally select a saved address explicitly
7. Optionally inspect the active address with `address-current`
8. Run preview
9. Place the order only after explicit user confirmation with `--confirm`

## Important rules

- Only Cash on Delivery has been validated for live checkout, and real orders require `--confirm`
- Use a saved Pakistan delivery address before running `preview`
- Cart switching still replaces the current cart when a different restaurant is used
- All errors are returned as JSON
- Location is required before search/menu/cart/preview flows
- This tool is Pakistan-specific
