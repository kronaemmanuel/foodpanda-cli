import type { Command } from "commander";
import { createClient, persistClient } from "../state.js";
import { persistLocation } from "../location-manager.js";

export function registerAddressCommands(program: Command): void {
  program
    .command("addresses")
    .description("List saved delivery addresses")
    .action(async () => {
      try {
        const client = createClient({ requireLocation: false });
        const addresses = await client.listSavedAddresses();
        persistClient(client);
        console.log(JSON.stringify(addresses, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("address-use <address_id>")
    .description("Select a saved delivery address by ID for preview and order")
    .action(async (addressId: string) => {
      try {
        const client = createClient({ requireLocation: false });
        const parsedId = parseInt(addressId, 10);
        if (Number.isNaN(parsedId)) {
          throw new Error("Address ID must be a valid number.");
        }

        const selected = await client.selectDeliveryAddress(parsedId);
        persistLocation(selected.latitude, selected.longitude);
        client.updateLocation(selected.latitude, selected.longitude);
        persistClient(client);
        console.log(
          JSON.stringify(
            {
              success: true,
              selected,
              location: {
                latitude: selected.latitude,
                longitude: selected.longitude,
              },
            },
            null,
            2
          )
        );
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("address-auto")
    .description("Clear the saved-address override and use nearest-address selection")
    .action(() => {
      try {
        const client = createClient({ requireLocation: false });
        client.clearSelectedDeliveryAddress();
        persistClient(client);
        console.log(JSON.stringify({ success: true, mode: "nearest" }, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("address-current")
    .description("Show the current address selection mode, active address, and synced location")
    .action(async () => {
      try {
        const client = createClient({ requireLocation: false });
        const current = await client.getCurrentAddressInfo();
        persistClient(client);
        console.log(JSON.stringify(current, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });
}
