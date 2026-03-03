import type { Command } from "commander";
import { createClient, persistClient } from "../state.js";

export function registerCartCommands(program: Command): void {
  program
    .command("add <vendor_code>")
    .description("Add items to cart")
    .requiredOption(
      "--items <json>",
      'JSON array of items: [{"item_id":"code","quantity":1,"topping_ids":["1"],"special_instructions":"..."}]'
    )
    .action(async (vendorCode: string, opts: { items: string }) => {
      try {
        const client = createClient();
        const parsed = JSON.parse(opts.items);
        if (!Array.isArray(parsed)) {
          throw new Error("--items must be a JSON array");
        }
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
