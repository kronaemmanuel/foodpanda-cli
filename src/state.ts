import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { FoodpandaClient, type SerializedState } from "./foodpanda-client.js";
import { resolveToken } from "./token-manager.js";
import { loadPersistedLocation } from "./location-manager.js";
import { APP_DATA_DIR, APP_NAME, SESSION_TOKEN_ENV_VAR } from "./config.js";

const STATE_DIR = join(homedir(), APP_DATA_DIR);
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
export function createClient(options: { requireLocation?: boolean } = {}): FoodpandaClient {
  const { requireLocation = true } = options;
  const { token: sessionToken } = resolveToken(SESSION_TOKEN_ENV_VAR);

  const location = loadPersistedLocation();

  if (!location && requireLocation) {
    throw new Error(
      `Location not set. Run ${APP_NAME} addresses, then ${APP_NAME} address-use <address_id>, or set it manually with ${APP_NAME} location <latitude> <longitude>.`
    );
  }

  const latitude = location?.latitude ?? 0;
  const longitude = location?.longitude ?? 0;

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
