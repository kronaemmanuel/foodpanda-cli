import type { Command } from "commander";
import { persistLocation } from "../location-manager.js";

export function registerLocationCommands(program: Command): void {
  program
    .command("location <latitude> <longitude>")
    .description("Set delivery location (latitude and longitude)")
    .action((latStr: string, lngStr: string) => {
      try {
        const latitude = parseFloat(latStr);
        const longitude = parseFloat(lngStr);

        if (isNaN(latitude) || isNaN(longitude)) {
          throw new Error("Latitude and longitude must be valid numbers.");
        }

        if (latitude < -90 || latitude > 90) {
          throw new Error("Latitude must be between -90 and 90.");
        }

        if (longitude < -180 || longitude > 180) {
          throw new Error("Longitude must be between -180 and 180.");
        }

        persistLocation(latitude, longitude);

        console.log(
          JSON.stringify({ success: true, latitude, longitude })
        );
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });
}
