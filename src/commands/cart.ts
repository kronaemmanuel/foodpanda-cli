import type { Command } from "commander";
import { readFileSync } from "fs";
import type { AddToCartInput } from "../types.js";
import { createClient, persistClient } from "../state.js";

function parseItemsInput(opts: {
  items?: string;
  itemsFile?: string;
  itemId?: string;
  quantity?: number;
  toppingIds?: string;
  specialInstructions?: string;
}): AddToCartInput[] {
  if (opts.items) {
    const parsed = JSON.parse(opts.items);
    if (!Array.isArray(parsed)) {
      throw new Error("--items must be a JSON array");
    }
    return parsed as AddToCartInput[];
  }

  if (opts.itemsFile) {
    const parsed = JSON.parse(readFileSync(opts.itemsFile, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("--items-file must contain a JSON array");
    }
    return parsed as AddToCartInput[];
  }

  if (opts.itemId) {
    return [
      {
        item_id: opts.itemId,
        quantity: opts.quantity ?? 1,
        topping_ids: opts.toppingIds
          ? opts.toppingIds
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : undefined,
        special_instructions: opts.specialInstructions,
      },
    ];
  }

  throw new Error(
    "Provide one of: --items <json>, --items-file <path>, or --item-id <id>."
  );
}

export function registerCartCommands(program: Command): void {
  program
    .command("add <vendor_code>")
    .description("Add items to cart")
    .option(
      "--items <json>",
      'JSON array of items: [{"item_id":"code","quantity":1,"topping_ids":["1"],"special_instructions":"..."}]'
    )
    .option("--items-file <path>", "Path to a JSON file containing the items array")
    .option("--item-id <id>", "Add a single item without JSON escaping")
    .option("--quantity <n>", "Quantity for --item-id mode", parseInt)
    .option("--topping-ids <ids>", "Comma-separated topping IDs for --item-id mode")
    .option("--special-instructions <text>", "Special instructions for --item-id mode")
    .action(async (vendorCode: string, opts: {
      items?: string;
      itemsFile?: string;
      itemId?: string;
      quantity?: number;
      toppingIds?: string;
      specialInstructions?: string;
    }) => {
      try {
        const client = createClient();
        const parsed = parseItemsInput(opts);
        const cart = await client.addToCart(vendorCode, parsed);
        persistClient(client);
        console.log(JSON.stringify(cart, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("cart")
    .description("View current cart contents")
    .action(async () => {
      try {
        const client = createClient();
        const cart = await client.getCart();
        persistClient(client);
        if (!cart) {
          console.log(JSON.stringify({ message: "Cart is empty." }));
        } else {
          console.log(JSON.stringify(cart, null, 2));
        }
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("remove <cart_item_id>")
    .description("Remove item from cart by cart item ID")
    .action(async (cartItemId: string) => {
      try {
        const client = createClient();
        const cart = await client.removeFromCart(cartItemId);
        persistClient(client);
        console.log(JSON.stringify(cart, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });
}
