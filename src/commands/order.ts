import type { Command } from "commander";
import { createClient, persistClient } from "../state.js";

export function registerOrderCommands(program: Command): void {
  program
    .command("preview")
    .description("Preview order with delivery address and COD payment readiness")
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
    .description("Place the current order using Cash on Delivery")
    .requiredOption("--payment <method>", "Payment method name (e.g. payment_on_delivery)")
    .requiredOption("--confirm", "Explicitly confirm that this should place a real order")
    .option("--instructions <text>", "Delivery instructions")
    .action(async (opts: { payment: string; confirm?: boolean; instructions?: string }) => {
      try {
        if (!opts.confirm) {
          throw new Error(
            "Real orders require explicit confirmation. Re-run with --confirm."
          );
        }
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
