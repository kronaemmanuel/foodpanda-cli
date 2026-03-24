---
name: foodpanda-pk-cli
description: Use this skill to browse restaurants, inspect menus, manage cart, select saved addresses, preview orders, and place confirmed Cash on Delivery orders on foodpanda Pakistan through the local CLI in this repository.
metadata: {"openclaw":{"skillKey":"foodpanda-pk-cli","emoji":"🍽️","requires":{"bins":["node","npm"]},"primaryEnv":"FOODPANDA_PK_SESSION_TOKEN"}}
user-invocable: true
---

# Foodpanda PK CLI

Use this skill when the user wants to interact with foodpanda Pakistan from this repository.

The repository root is `{baseDir}/../..`.

## Setup

Before first use, ensure the CLI is built from the repository root:

```bash
cd "{baseDir}/../.."
npm install
npm run build
```

Prefer running the local built CLI directly:

```bash
cd "{baseDir}/../.."
node build/cli.js --help
```

If browser login capture fails, the skill can use the session token env var:

```bash
FOODPANDA_PK_SESSION_TOKEN=...
```

For long-lived use, prefer checking and refreshing auth through the CLI:

```bash
cd "{baseDir}/../.."
node build/cli.js auth-status
node build/cli.js auth-refresh
```

`auth-refresh` reuses the CLI's own persistent browser profile under `~/.foodpanda-pk-cli/browser-data`.
It does not directly read from OpenClaw's managed `openclaw` Chrome profile.

## Address-first workflow

Use this order unless the user explicitly asks for manual location control:

1. Log in:
   `node build/cli.js login`
2. If auth later expires, refresh it:
   `node build/cli.js auth-refresh`
3. List saved addresses:
   `node build/cli.js addresses`
4. Select a saved address:
   `node build/cli.js address-use <address_id>`
5. Optionally verify the active address and synced location:
   `node build/cli.js address-current`
6. Search restaurants:
   `node build/cli.js search "<query>" --limit 5`
7. Inspect restaurant and menu:
   `node build/cli.js restaurant <vendor_code>`
   `node build/cli.js menu <vendor_code>`
   `node build/cli.js item <vendor_code> <product_code>`
8. Add items to cart:
   `node build/cli.js add <vendor_code> --item-id <product_code> --quantity 1`
9. Review cart and preview:
   `node build/cli.js cart`
   `node build/cli.js preview`
10. Only after explicit user confirmation, place the order:
   `node build/cli.js order --payment payment_on_delivery --confirm`

## Notes

- `address-use` is the normal way to set delivery location. It syncs `location.json` automatically.
- Manual `location` is fallback-only. Use it only if the user explicitly wants nearest-address behavior without selecting a saved address.
- `auth-status` shows whether the CLI is using an env-var token or its persisted token cache.
- Session expiry is expected. Recover with `auth-refresh`.
- For Windows shells, prefer `--item-id` or `--items-file` over escaped JSON for `add`.
- `order` places a real order. Never run it without clear user confirmation in the conversation.
- Live checkout has only been validated for `payment_on_delivery`.
