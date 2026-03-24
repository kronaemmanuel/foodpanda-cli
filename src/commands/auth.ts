import type { Command } from "commander";
import {
  getBrowserDataDir,
  hasPersistedBrowserProfile,
  maskToken,
  refreshAndPersistTokenViaBrowser,
  resolveToken,
} from "../token-manager.js";
import { loadPersistedLocation } from "../location-manager.js";
import { SESSION_TOKEN_ENV_VAR } from "../config.js";

async function runRefresh(timeoutSeconds: number): Promise<void> {
  const token = await refreshAndPersistTokenViaBrowser(timeoutSeconds);
  console.log(
    JSON.stringify(
      {
        success: true,
        token: maskToken(token),
        source: "persisted",
        browser_profile_path: getBrowserDataDir(),
      },
      null,
      2
    )
  );
}

export function registerAuthCommands(program: Command): void {
  program
    .command("login")
    .description("Open browser to log in and refresh session token")
    .option("--timeout <seconds>", "Login timeout in seconds", parseInt)
    .action(async (opts: { timeout?: number }) => {
      try {
        await runRefresh(opts.timeout ?? 120);
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("auth-refresh")
    .description("Refresh the session token using the persistent browser profile")
    .option("--timeout <seconds>", "Refresh timeout in seconds", parseInt)
    .action(async (opts: { timeout?: number }) => {
      try {
        await runRefresh(opts.timeout ?? 120);
      } catch (error) {
        console.log(JSON.stringify({ error: (error as Error).message }));
        process.exit(1);
      }
    });

  program
    .command("auth-status")
    .description("Show the current auth source, token cache status, and browser profile state")
    .action(() => {
      try {
        const tokenInfo = resolveToken(SESSION_TOKEN_ENV_VAR);
        const location = loadPersistedLocation();

        console.log(
          JSON.stringify(
            {
              authenticated: tokenInfo.token !== null,
              token_source: tokenInfo.source,
              token: maskToken(tokenInfo.token),
              token_saved_at: tokenInfo.savedAt,
              env_var: SESSION_TOKEN_ENV_VAR,
              browser_profile_exists: hasPersistedBrowserProfile(),
              browser_profile_path: getBrowserDataDir(),
              location_configured: location !== null,
              location,
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
}
