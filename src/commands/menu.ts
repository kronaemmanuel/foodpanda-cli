import type { Command } from "commander";
import { createClient, persistClient } from "../state.js";

export function registerMenuCommands(program: Command): void {
  program
    .command("menu <vendor_code>")
    .description("Get restaurant menu organized by category")
    .action(async (vendorCode: string) => {
      try {
        const client = createClient();
        const menu = await client.getMenu(vendorCode);
        // Compact view: strip topping_groups for readability
        const compact = menu.map((cat) => ({
          name: cat.name,
          items: cat.items.map((item) => ({
            code: item.code,
            name: item.name,
            price: item.price,
            description: item.description || undefined,
            is_sold_out: item.is_sold_out || undefined,
          })),
        }));
        persistClient(client);
        console.log(JSON.stringify(compact, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("item <vendor_code> <product_code>")
    .description("Get full item details including toppings and variations")
    .action(async (vendorCode: string, productCode: string) => {
      try {
        const client = createClient();
        const menu = await client.getMenu(vendorCode);
        for (const cat of menu) {
          const item = cat.items.find((i) => i.code === productCode);
          if (item) {
            persistClient(client);
            console.log(JSON.stringify({ category: cat.name, ...item }, null, 2));
            return;
          }
        }
        persistClient(client);
        console.log(JSON.stringify({ error: `Item "${productCode}" not found in menu for "${vendorCode}".` }));
        process.exit(1);
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });
}
