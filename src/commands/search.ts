import type { Command } from "commander";
import { createClient, persistClient } from "../state.js";

export function registerSearchCommands(program: Command): void {
  program
    .command("search <query>")
    .description("Search for restaurants by name or cuisine")
    .option("--cuisine <type>", "Filter by cuisine type")
    .option("--limit <n>", "Max results", parseInt)
    .action(async (query: string, opts: { cuisine?: string; limit?: number }) => {
      try {
        const client = createClient();
        const results = await client.searchRestaurants(query, opts.cuisine, opts.limit);
        persistClient(client);
        console.log(JSON.stringify(results, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("outlets <chain_code>")
    .description("List all outlets for a restaurant chain")
    .action(async (chainCode: string) => {
      try {
        const client = createClient();
        const outlets = await client.getChainOutlets(chainCode);
        persistClient(client);
        console.log(JSON.stringify(outlets, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("restaurant <vendor_code>")
    .description("Get restaurant details")
    .action(async (vendorCode: string) => {
      try {
        const client = createClient();
        const details = await client.getRestaurantDetails(vendorCode);
        persistClient(client);
        console.log(JSON.stringify(details, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });
}
