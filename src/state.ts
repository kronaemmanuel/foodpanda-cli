import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { FoodpandaClient, type SerializedState } from "./foodpanda-client.js";
import { loadPersistedToken } from "./token-manager.js";
import { loadPersistedLocation } from "./location-manager.js";

const STATE_DIR = join(homedir(), ".foodpanda-cli");
const STATE_FILE = join(STATE_DIR, "state.json");

function loadState(): SerializedState | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as SerializedState;
  } catch {
    return null;
  }
}

function saveState(state: SerializedState): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(STATE_FILE, JSON.stringify(state), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Create a FoodpandaClient with state restored from disk.
 * Returns the client. After executing a command, call `persistClient(client)`.
 */
export function createClient(): FoodpandaClient {
  const sessionToken =
    loadPersistedToken() || process.env.FOODPANDA_SESSION_TOKEN || null;

  const location = loadPersistedLocation();

  if (!location) {
    throw new Error(
      "Location not set. Run: foodpanda-cli location <latitude> <longitude>"
    );
  }

  const { latitude, longitude } = location;

  const client = new FoodpandaClient(sessionToken, latitude, longitude);

  const savedState = loadState();
  if (savedState) {
    client.deserialize(savedState);
  }

  return client;
}

/** Persist client state to disk after a command completes */
export function persistClient(client: FoodpandaClient): void {
  saveState(client.serialize());
}
