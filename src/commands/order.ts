import type { Command } from "commander";
import { createClient, persistClient } from "../state.js";

export function registerOrderCommands(program: Command): void {
  program
    .command("preview")
    .description("Preview order with delivery address and payment methods")
    .action(async () => {
      try {
        const client = createClient();
        const preview = await client.previewOrder();
        persistClient(client);
        console.log(JSON.stringify(preview, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("order")
    .description("Place the current order")
    .requiredOption("--payment <method>", "Payment method name (e.g. payment_on_delivery)")
    .option("--instructions <text>", "Delivery instructions")
    .action(async (opts: { payment: string; instructions?: string }) => {
      try {
        const client = createClient();
        const result = await client.placeOrder(opts.payment, opts.instructions);
        persistClient(client);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });
}
