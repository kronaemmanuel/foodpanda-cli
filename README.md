# foodpanda-pk-cli

CLI for ordering food from foodpanda.pk, adapted for Pakistan and intended for AI-assisted shell workflows.

All command output is JSON.

## Current Scope

Supported in this fork:
- Pakistan login flow
- Saved-address-driven location sync
- Restaurant search and discovery
- Restaurant details and menu browsing
- Saved-address listing and explicit address selection
- Cart add/remove/view
- Order preview with saved-address resolution
- COD-oriented preview output
- Live order placement with Cash on Delivery

## Setup

```bash
npm install
npm run build
```

You can then run the built CLI with:

```bash
node build/cli.js --help
```

If you want a global/local package install after building:

```bash
npm install -g .
foodpanda-pk-cli --help
```

## OpenClaw Skill

This repo now includes an OpenClaw-compatible skill at:

```text
skills/foodpanda-pk-cli/
```

You can use it in OpenClaw in either of these ways:

1. Put or copy the skill folder into an OpenClaw skill directory:
   - `<workspace>/skills/foodpanda-pk-cli`
   - `~/.openclaw/skills/foodpanda-pk-cli`
2. Or point OpenClaw at this repo's `skills/` directory through `~/.openclaw/openclaw.json`:

```json5
{
  skills: {
    load: {
      extraDirs: ["D:/dev/foodpanda-cli/skills"]
    }
  }
}
```

The OpenClaw skill uses the repo-local CLI via `node build/cli.js ...`, so the repo should still be built with:

```bash
npm install
npm run build
```

## Initial Setup

### 1. Log in

```bash
foodpanda-pk-cli login
```

This opens foodpanda Pakistan in a browser and captures the session token from live requests.

If browser capture does not work, set the session token manually through the environment:

```bash
$env:FOODPANDA_PK_SESSION_TOKEN = "your-session-token"
```

### 2. Select a saved address

```bash
foodpanda-pk-cli addresses
foodpanda-pk-cli address-use <address_id>
```

`address-use` is the normal way to initialize location for the CLI. It selects one of your saved foodpanda Pakistan addresses and syncs the CLI location to that address automatically.

Location is stored in `~/.foodpanda-pk-cli/location.json` after address selection.

### Optional manual location override

```bash
foodpanda-pk-cli location <latitude> <longitude>
```

You usually do not need this. It is only useful if you want nearest-address fallback behavior without selecting an explicit saved address first.

Token, browser data, and cached state are stored under `~/.foodpanda-pk-cli/`.

## Commands

### Search and discovery

```bash
foodpanda-pk-cli search "biryani" --limit 5
foodpanda-pk-cli search "pizza" --cuisine "Fast Food" --limit 5
foodpanda-pk-cli outlets <chain_code>
foodpanda-pk-cli restaurant <vendor_code>
```

### Menu

```bash
foodpanda-pk-cli menu <vendor_code>
foodpanda-pk-cli item <vendor_code> <product_code>
```

### Cart

```bash
foodpanda-pk-cli add <vendor_code> --items '[{"item_id":"product-code","quantity":1}]'
foodpanda-pk-cli add <vendor_code> --items-file .\items.json
foodpanda-pk-cli add <vendor_code> --item-id product-code --quantity 1
foodpanda-pk-cli cart
foodpanda-pk-cli remove <cart_item_id>
```

For Windows-friendly usage, prefer `--items-file` or the single-item flags (`--item-id`, `--quantity`, `--topping-ids`, `--special-instructions`) instead of manually escaped JSON.

### Addresses

```bash
foodpanda-pk-cli addresses
foodpanda-pk-cli address-use <address_id>
foodpanda-pk-cli address-auto
foodpanda-pk-cli address-current
```

`addresses` lists your saved foodpanda Pakistan addresses.

`address-use` pins preview/order to a specific saved address ID and also updates the CLI location to that address's coordinates automatically.

`address-auto` clears the override and returns to nearest-address selection based on the currently synced `location`.

`address-current` shows the active selection mode, the current synced location, and the address that preview/order will use.

### Preview

```bash
foodpanda-pk-cli preview
```

`preview` requires:
- a non-empty cart
- a logged-in Pakistan account
- at least one saved delivery address in your foodpanda Pakistan account

Preview output is intentionally COD-focused in this fork.
If you used `address-use`, preview and order will use that saved address instead of the nearest one.

### Order

```bash
foodpanda-pk-cli order --payment payment_on_delivery --confirm
```

Live ordering is currently supported only for `payment_on_delivery` after a successful `preview`.
`--confirm` is required because this places a real order.

## Recommended Workflow

1. Run `login`.
2. Run `addresses`.
3. Run `address-use <address_id>` to select the saved address you want to use; this syncs the CLI location automatically.
4. Optionally run `address-current` to verify the active address and location state.
5. Search restaurants.
6. Inspect a restaurant and browse its menu.
7. Add items to cart.
8. Run `preview`.
9. If the user confirms, place the order with Cash on Delivery using `--confirm`.

## Suggested Live Smoke Test

Suggested live smoke test using a saved Multan address:

1. `foodpanda-pk-cli login`
2. `foodpanda-pk-cli addresses`
3. `foodpanda-pk-cli address-use <address_id>`
4. `foodpanda-pk-cli address-current`
5. `foodpanda-pk-cli search "biryani" --limit 5`
6. `foodpanda-pk-cli restaurant <vendor_code>`
7. `foodpanda-pk-cli menu <vendor_code>`
8. `foodpanda-pk-cli add <vendor_code> --item-id product-code --quantity 1`
9. `foodpanda-pk-cli cart`
10. `foodpanda-pk-cli preview`
11. `foodpanda-pk-cli order --payment payment_on_delivery --confirm`

## Limitations

- Pakistan market assumptions are centralized, but some internal API details are still reverse-engineered rather than officially documented
- Live checkout has only been validated for Cash on Delivery
- The repo is restaurant-focused only

## License

[MIT](LICENSE)
