import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { APP_DATA_DIR } from "./config.js";

const LOCATION_DIR = join(homedir(), APP_DATA_DIR);
const LOCATION_FILE = join(LOCATION_DIR, "location.json");

interface PersistedLocation {
  latitude: number;
  longitude: number;
  savedAt: string;
}

export function loadPersistedLocation(): {
  latitude: number;
  longitude: number;
} | null {
  try {
    if (!existsSync(LOCATION_FILE)) return null;
    const data = JSON.parse(
      readFileSync(LOCATION_FILE, "utf-8")
    ) as PersistedLocation;
    if (
      data &&
      typeof data.latitude === "number" &&
      typeof data.longitude === "number" &&
      !isNaN(data.latitude) &&
      !isNaN(data.longitude)
    ) {
      return { latitude: data.latitude, longitude: data.longitude };
    }
    return null;
  } catch {
    return null;
  }
}

export function persistLocation(latitude: number, longitude: number): void {
  mkdirSync(LOCATION_DIR, { recursive: true, mode: 0o700 });
  const data: PersistedLocation = {
    latitude,
    longitude,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(LOCATION_FILE, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}
