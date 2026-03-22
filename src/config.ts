export const APP_NAME = "foodpanda-pk-cli";
export const APP_DESCRIPTION =
  "CLI for ordering food from foodpanda.pk — designed for AI assistants";
export const APP_DATA_DIR = ".foodpanda-pk-cli";
export const SESSION_TOKEN_ENV_VAR = "FOODPANDA_PK_SESSION_TOKEN";

export const MARKET_CONFIG = {
  siteUrl: "https://www.foodpanda.pk",
  apiBaseUrl: "https://pk.fd-api.com",
  apiHost: "pk.fd-api.com",
  locale: "en_PK",
  languageId: 1,
  currency: "PKR",
  globalEntityId: "FP_PK",
  paymentRedirectUrl: "https://www.foodpanda.pk/payments/handle-payment/",
  cashOnDeliveryMethod: "payment_on_delivery",
  supportedPreviewPaymentMethodNames: ["payment_on_delivery"] as readonly string[],
} as const;

export const MULTAN_COORDINATES = {
  latitude: 30.2088719,
  longitude: 71.4886923,
} as const;
