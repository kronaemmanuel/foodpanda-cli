import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { APP_DATA_DIR, MARKET_CONFIG } from "./config.js";

const TOKEN_DIR = join(homedir(), APP_DATA_DIR);
const TOKEN_FILE = join(TOKEN_DIR, "token.json");
const BROWSER_DATA_DIR = join(TOKEN_DIR, "browser-data");

interface PersistedToken {
  token: string;
  savedAt: string;
}

export interface ResolvedTokenInfo {
  token: string | null;
  source: "environment" | "persisted" | "none";
  savedAt: string | null;
}

function loadPersistedTokenRecord(): PersistedToken | null {
  try {
    if (!existsSync(TOKEN_FILE)) return null;
    const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as PersistedToken;
    if (data && typeof data.token === "string" && data.token.length > 0) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export function loadPersistedToken(): string | null {
  return loadPersistedTokenRecord()?.token ?? null;
}

export function resolveToken(
  envVarName: string,
  env: NodeJS.ProcessEnv = process.env
): ResolvedTokenInfo {
  const envToken = env[envVarName]?.trim();
  if (envToken) {
    return {
      token: envToken,
      source: "environment",
      savedAt: null,
    };
  }

  const persisted = loadPersistedTokenRecord();
  if (persisted) {
    return {
      token: persisted.token,
      source: "persisted",
      savedAt: persisted.savedAt,
    };
  }

  return {
    token: null,
    source: "none",
    savedAt: null,
  };
}

export function hasPersistedBrowserProfile(): boolean {
  return existsSync(BROWSER_DATA_DIR);
}

export function getBrowserDataDir(): string {
  return BROWSER_DATA_DIR;
}

export function maskToken(token: string | null): string | null {
  if (!token) return null;
  return token.length > 16
    ? `${token.slice(0, 8)}...${token.slice(-8)}`
    : "****";
}

export function persistToken(token: string): void {
  mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  const data: PersistedToken = {
    token,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

interface RefreshTokenViaBrowserOptions {
  timeoutSeconds?: number;
  headless?: boolean;
  operationLabel?: string;
}

interface BrowserJsonRequestOptions {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutSeconds?: number;
  headless?: boolean;
}

interface BrowserJsonResponse {
  ok: boolean;
  status: number;
  bodyText: string;
}

async function getStealthChromium(): Promise<
  Awaited<typeof import("playwright-extra")>["chromium"]
> {
  try {
    const pw = await import("playwright-extra");
    const stealthModule = await import("puppeteer-extra-plugin-stealth");
    const StealthPlugin = stealthModule.default;
    const chromium = pw.chromium;
    chromium.use(StealthPlugin());
    return chromium;
  } catch {
    throw new Error(
      "Playwright is not installed. Run: npm install playwright-extra puppeteer-extra-plugin-stealth"
    );
  }
}

async function launchPersistentBrowser(headless: boolean) {
  const chromium = await getStealthChromium();

  mkdirSync(BROWSER_DATA_DIR, { recursive: true, mode: 0o700 });

  try {
    return await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
      headless,
    });
  } catch (err) {
    throw new Error(
      `Failed to launch browser. Run: npx playwright install chromium\n${(err as Error).message}`
    );
  }
}

export async function refreshTokenViaBrowser(
  options: RefreshTokenViaBrowserOptions = {}
): Promise<string> {
  const {
    timeoutSeconds = 120,
    headless = false,
    operationLabel = headless ? "Auth refresh" : "Login",
  } = options;

  let context;
  try {
    // Persistent context preserves cookies across refreshes so the user
    // may already be logged in from a previous session.
    context = await launchPersistentBrowser(headless);
  } catch (err) {
    throw err;
  }

  try {
    const page = context.pages()[0] || await context.newPage();

    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `${operationLabel} timed out after ${timeoutSeconds} seconds. ${
              headless
                ? "If your saved cookies are no longer valid, run the visible login flow."
                : "Please try again."
            }`
          )
        );
      }, timeoutSeconds * 1000);

      page.on("request", (request) => {
        const url = request.url();
        if (!url.includes(MARKET_CONFIG.apiHost)) return;

        const authHeader = request.headers()["authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) return;

        const token = authHeader.slice("Bearer ".length).trim();
        if (token.length === 0) return;

        // Validate JWT structure (header.payload.signature)
        if (token.split(".").length !== 3) return;

        clearTimeout(timer);
        resolve(token);
      });

      page.goto(MARKET_CONFIG.siteUrl).catch((err) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Failed to navigate to ${MARKET_CONFIG.siteUrl}: ${(err as Error).message}`
          )
        );
      });
    });
  } finally {
    await context.close().catch(() => {});
  }
}

export async function refreshAndPersistTokenViaBrowser(
  options: RefreshTokenViaBrowserOptions = {}
): Promise<string> {
  const token = await refreshTokenViaBrowser(options);
  persistToken(token);
  return token;
}

export async function requestJsonViaBrowser(
  options: BrowserJsonRequestOptions
): Promise<BrowserJsonResponse> {
  const {
    path,
    method = "GET",
    headers = {},
    body,
    timeoutSeconds = 30,
    headless = true,
  } = options;

  const context = await launchPersistentBrowser(headless);

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(MARKET_CONFIG.siteUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutSeconds * 1000,
    });

    return await page.evaluate(
      async ({
        url,
        method,
        headers,
        body,
        timeoutMs,
      }: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
        timeoutMs: number;
      }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(url, {
            method,
            headers,
            body,
            credentials: "include",
            signal: controller.signal,
          });

          return {
            ok: response.ok,
            status: response.status,
            bodyText: await response.text(),
          };
        } finally {
          clearTimeout(timer);
        }
      },
      {
        url: `${MARKET_CONFIG.apiBaseUrl}${path}`,
        method,
        headers,
        body,
        timeoutMs: timeoutSeconds * 1000,
      }
    );
  } finally {
    await context.close().catch(() => {});
  }
}
