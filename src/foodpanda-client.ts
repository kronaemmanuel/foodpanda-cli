import type {
  Restaurant,
  RestaurantDetails,
  MenuCategory,
  MenuItem,
  Cart,
  CartItem,
  OrderResult,
  AddToCartInput,
  CartProductPayload,
  CartToppingPayload,
  CartVendorPayload,
  CartCalculateRequest,
  ToppingGroup,
  ScheduleEntry,
  CustomerProfile,
  DeliveryAddress,
  PaymentMethodInfo,
  OrderPreview,
  SavedAddressSummary,
  CurrentAddressInfo,
} from "./types.js";
import { APP_NAME, MARKET_CONFIG } from "./config.js";

const GRAPHQL_SEARCH_HASH =
  "6d4dea2e0c8ab03c0d2934ca3db20b8914fc17e4109fb103307e4c077ba8506d";
const GRAPHQL_VENDOR_LIST_HASH =
  "ee02950ba8ef08427ef979e3954e3c1367c5636b18d6fc8a850ebf5fbf49d999";
const MENU_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Shared shape for vendor menu data from the REST API */
interface VendorMenuData {
  menu_categories: Array<{
    name: string;
    products: Array<{
      id: number;
      code: string;
      name: string;
      description: string;
      file_path: string;
      is_sold_out: boolean;
      product_variations: Array<{
        id: number;
        code: string;
        price: number;
        topping_ids: number[];
      }>;
    }>;
  }>;
  toppings: Record<
    string,
    {
      id: number;
      name: string;
      quantity_minimum: number;
      quantity_maximum: number;
      options: Array<{
        id: number;
        product_id: number;
        name: string;
        price: number;
      }>;
    }
  >;
}

/** Shape expected by cacheVendorMenu */
interface VendorMenuInput {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  menus: VendorMenuData[];
}

/**
 * Cached menu data per vendor, so we can build cart payloads
 * without re-fetching the menu every time.
 */
interface CachedVendorMenu {
  vendorCode: string;
  vendorName: string;
  vendorLatitude: number;
  vendorLongitude: number;
  categories: MenuCategory[];
  /** Flat lookup: product code -> MenuItem */
  productsByCode: Map<string, MenuItem>;
  /** Flat lookup: product id -> MenuItem */
  productsById: Map<number, MenuItem>;
  /** Flat lookup: topping option id -> { id, name, price } */
  toppingOptionsById: Map<number, { id: number; name: string; price: number }>;
  /** Timestamp when this cache entry was created */
  cachedAt: number;
}

/** Serializable snapshot of client state for CLI persistence */
export interface SerializedState {
  cartProducts: CartProductPayload[];
  cartItemIds: string[];
  cartVendor: CartVendorPayload | null;
  cartVendorName: string;
  cartItems: CartItem[];
  cartSubtotal: number;
  cartDeliveryFee: number;
  cartServiceFee: number;
  cartTotal: number;
  nextCartItemId: number;
  menuCache: Array<{
    key: string;
    value: {
      vendorCode: string;
      vendorName: string;
      vendorLatitude: number;
      vendorLongitude: number;
      categories: MenuCategory[];
      productsByCode: Array<[string, MenuItem]>;
      productsById: Array<[number, MenuItem]>;
      toppingOptionsById: Array<[number, { id: number; name: string; price: number }]>;
      cachedAt: number;
    };
  }>;
  checkoutState: {
    customer: CustomerProfile;
    address: DeliveryAddress;
    purchaseIntentId: string;
    paymentMethods: PaymentMethodInfo[];
  } | null;
  cachedCustomerProfile: CustomerProfile | null;
  selectedDeliveryAddressId: number | null;
}

export class FoodpandaClient {
  private sessionToken: string | null;
  private latitude: number;
  private longitude: number;
  private customerCode: string;
  private perseusClientId: string;
  private perseusSessionId: string;

  // In-memory cart state (foodpanda cart is stateless / server recalculates)
  private cartProducts: CartProductPayload[] = [];
  private cartItemIds: string[] = []; // stable IDs aligned with cartProducts
  private cartVendor: CartVendorPayload | null = null;
  private cartVendorName: string = "";
  private cartItems: CartItem[] = [];
  private cartSubtotal: number = 0;
  private cartDeliveryFee: number = 0;
  private cartServiceFee: number = 0;
  private cartTotal: number = 0;
  private nextCartItemId: number = 1;
  private selectedDeliveryAddressId: number | null = null;

  // Menu cache keyed by vendor code
  private menuCache: Map<string, CachedVendorMenu> = new Map();

  constructor(sessionToken: string | null, latitude: number, longitude: number) {
    this.sessionToken = sessionToken;
    this.latitude = latitude;
    this.longitude = longitude;
    this.customerCode = sessionToken ? this.extractCustomerCode(sessionToken) : "";

    // Generate Perseus tracking IDs (required by GraphQL endpoint)
    const ts = Date.now();
    const rand1 = Math.random().toString().slice(2, 20);
    const rand2 = Math.random().toString(36).slice(2, 12);
    this.perseusClientId = `${ts}.${rand1}.${rand2}`;
    const rand3 = Math.random().toString().slice(2, 20);
    const rand4 = Math.random().toString(36).slice(2, 12);
    this.perseusSessionId = `${ts}.${rand3}.${rand4}`;
  }

  /**
   * Decode the JWT payload to extract user_id (customer code).
   * JWT format: header.payload.signature — payload is base64url-encoded JSON.
   */
  private extractCustomerCode(token: string): string {
    try {
      const parts = token.split(".");
      if (parts.length < 2) return "";
      // base64url -> base64
      let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      // pad to multiple of 4
      while (payload.length % 4 !== 0) payload += "=";
      const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
      return decoded.user_id || "";
    } catch {
      return "";
    }
  }

  /**
   * Hot-swap the session token (e.g. after a browser-based refresh).
   * Re-extracts the customer code from the new JWT.
   */
  public updateSessionToken(token: string): void {
    this.sessionToken = token;
    this.customerCode = this.extractCustomerCode(token);
  }

  public updateLocation(latitude: number, longitude: number): void {
    this.latitude = latitude;
    this.longitude = longitude;
  }

  public getLocation(): { latitude: number; longitude: number } {
    return {
      latitude: this.latitude,
      longitude: this.longitude,
    };
  }

  // ----------------------------------------------------------------
  // HTTP helpers
  // ----------------------------------------------------------------

  private commonHeaders(): Record<string, string> {
    if (!this.sessionToken) {
      throw new Error(
        `No session token configured. Run ${APP_NAME} login or set ${APP_NAME}'s session token env var.`
      );
    }
    return {
      Authorization: `Bearer ${this.sessionToken}`,
      "x-fp-api-key": "volo",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "perseus-client-id": this.perseusClientId,
      "perseus-session-id": this.perseusSessionId,
    };
  }

  private async restRequest<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${MARKET_CONFIG.apiBaseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.commonHeaders(),
        "x-pd-language-id": String(MARKET_CONFIG.languageId),
        "Content-Type": "application/json",
        ...((options.headers as Record<string, string>) || {}),
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Session token expired or invalid. Run ${APP_NAME} auth-refresh or ${APP_NAME} login again.`
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Foodpanda API error (${response.status}): ${body.slice(0, 500)}`
      );
    }
    return response.json() as Promise<T>;
  }

  private async graphqlRequest<T>(body: object, displayContext: string = "SEARCH"): Promise<T> {
    const url = `${MARKET_CONFIG.apiBaseUrl}/graphql`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.commonHeaders(),
        "Content-Type": "application/json",
        "customer-code": this.customerCode,
        "customer-latitude": String(this.latitude),
        "customer-longitude": String(this.longitude),
        "display-context": displayContext,
        platform: "web",
        locale: MARKET_CONFIG.locale,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Session token expired or invalid. Run ${APP_NAME} auth-refresh or ${APP_NAME} login again.`
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Foodpanda GraphQL error (${response.status}): ${text.slice(0, 500)}`
      );
    }
    return response.json() as Promise<T>;
  }

  // ----------------------------------------------------------------
  // 1. Search Restaurants
  // ----------------------------------------------------------------

  async searchRestaurants(
    query: string,
    cuisine?: string,
    limit?: number
  ): Promise<Restaurant[]> {
    const body = {
      extensions: {
        persistedQuery: {
          sha256Hash: GRAPHQL_SEARCH_HASH,
          version: 1,
        },
      },
      variables: {
        searchResultsParams: {
          query,
          latitude: this.latitude,
          longitude: this.longitude,
          locale: MARKET_CONFIG.locale,
          languageId: MARKET_CONFIG.languageId,
          expeditionType: "DELIVERY",
          customerType: "B2C",
          verticalTypes: ["RESTAURANTS"],
        },
        skipQueryCorrection: true,
      },
    };

    interface GqlResponse {
      data: {
        searchPage: {
          components: Array<{
            vendorData?: {
              code: string;
              name: string;
              availability: {
                status: string;
                distanceInMeters: number;
              };
              vendorRating: {
                value: number;
                count: number;
              };
              dynamicPricing: {
                deliveryFee: { total: number };
                minimumOrderValue: { total: number };
              };
              timeEstimations: {
                delivery: {
                  duration: {
                    lowerLimitInMinutes: number;
                    upperLimitInMinutes: number;
                  };
                } | null;
              };
              vendorTile?: {
                vendorInfo?: Array<
                  Array<{
                    id: string;
                    elements: Array<{
                      text: string;
                    }>;
                  }>
                >;
              };
            };
            vendorChainData?: {
              code: string;
              name: string;
            };
            totalChainVendors?: number;
          }>;
        };
      };
    }

    const result = await this.graphqlRequest<GqlResponse>(body);

    const components = result.data?.searchPage?.components || [];
    const restaurants: Restaurant[] = [];

    for (const comp of components) {
      const v = comp.vendorData;
      if (!v) continue;

      // Extract cuisines from vendorTile
      const cuisines: string[] = [];
      if (v.vendorTile?.vendorInfo) {
        for (const row of v.vendorTile.vendorInfo) {
          for (const group of row) {
            if (group.id === "VENDOR_INFO_CUISINES" && group.elements) {
              for (const el of group.elements) {
                if (el.text) cuisines.push(el.text);
              }
            }
          }
        }
      }

      const delivery = v.timeEstimations?.delivery?.duration;
      const deliveryTime = delivery
        ? `${delivery.lowerLimitInMinutes}-${delivery.upperLimitInMinutes} min`
        : "N/A";

      const restaurant: Restaurant = {
        id: v.code,
        name: v.name,
        cuisine: cuisines,
        rating: v.vendorRating?.value ?? 0,
        review_count: v.vendorRating?.count ?? 0,
        delivery_fee: v.dynamicPricing?.deliveryFee?.total ?? 0,
        delivery_time: deliveryTime,
        minimum_order: v.dynamicPricing?.minimumOrderValue?.total ?? 0,
        distance_km: Math.round((v.availability?.distanceInMeters ?? 0) / 100) / 10,
        is_open: v.availability?.status === "OPEN",
      };

      // Attach chain data if this vendor belongs to a chain
      if (comp.vendorChainData?.code) {
        restaurant.chain_code = comp.vendorChainData.code;
        restaurant.chain_name = comp.vendorChainData.name;
      }
      if (comp.totalChainVendors && comp.totalChainVendors > 1) {
        restaurant.total_outlets = comp.totalChainVendors;
      }

      restaurants.push(restaurant);
    }

    // Client-side cuisine filter
    let filtered = restaurants;
    if (cuisine) {
      const cuisineLower = cuisine.toLowerCase();
      filtered = restaurants.filter((r) =>
        r.cuisine.some((c) => c.toLowerCase().includes(cuisineLower))
      );
    }

    const maxResults = limit ?? 10;
    return filtered.slice(0, maxResults);
  }

  // ----------------------------------------------------------------
  // 1b. List Chain Outlets
  // ----------------------------------------------------------------

  async getChainOutlets(chainCode: string): Promise<Restaurant[]> {
    const body = {
      extensions: {
        persistedQuery: {
          sha256Hash: GRAPHQL_VENDOR_LIST_HASH,
          version: 1,
        },
      },
      variables: {
        input: {
          expeditionType: "DELIVERY",
          latitude: this.latitude,
          longitude: this.longitude,
          locale: MARKET_CONFIG.locale,
          customerType: "B2C",
          languageId: MARKET_CONFIG.languageId,
          page: "CHAIN_LISTING_PAGE",
          availabilityFilters: {
            chainCodes: [chainCode],
          },
        },
      },
    };

    interface ChainGqlResponse {
      data: {
        vendorListingPage: {
          components: Array<{
            vendorData?: {
              code: string;
              name: string;
              availability: {
                status: string;
                distanceInMeters: number;
              };
              vendorRating: {
                value: number;
                count: number;
              };
              dynamicPricing: {
                deliveryFee: { total: number };
                minimumOrderValue: { total: number };
              };
              timeEstimations: {
                delivery: {
                  duration: {
                    lowerLimitInMinutes: number;
                    upperLimitInMinutes: number;
                  };
                } | null;
              };
              vendorTile?: {
                vendorInfo?: Array<
                  Array<{
                    id: string;
                    elements: Array<{
                      text: string;
                    }>;
                  }>
                >;
              };
            };
          }>;
        };
      };
    }

    const result = await this.graphqlRequest<ChainGqlResponse>(body, "rlp");


    const components = result.data?.vendorListingPage?.components || [];
    const restaurants: Restaurant[] = [];

    for (const comp of components) {
      const v = comp.vendorData;
      if (!v) continue;

      // Extract cuisines from vendorTile
      const cuisines: string[] = [];
      if (v.vendorTile?.vendorInfo) {
        for (const row of v.vendorTile.vendorInfo) {
          for (const group of row) {
            if (group.id === "VENDOR_INFO_CUISINES" && group.elements) {
              for (const el of group.elements) {
                if (el.text) cuisines.push(el.text);
              }
            }
          }
        }
      }

      const delivery = v.timeEstimations?.delivery?.duration;
      const deliveryTime = delivery
        ? `${delivery.lowerLimitInMinutes}-${delivery.upperLimitInMinutes} min`
        : "N/A";

      restaurants.push({
        id: v.code,
        name: v.name,
        cuisine: cuisines,
        rating: v.vendorRating?.value ?? 0,
        review_count: v.vendorRating?.count ?? 0,
        delivery_fee: v.dynamicPricing?.deliveryFee?.total ?? 0,
        delivery_time: deliveryTime,
        minimum_order: v.dynamicPricing?.minimumOrderValue?.total ?? 0,
        distance_km: Math.round((v.availability?.distanceInMeters ?? 0) / 100) / 10,
        is_open: v.availability?.status === "OPEN",
        chain_code: chainCode,
      });
    }

    return restaurants;
  }

  // ----------------------------------------------------------------
  // 2. Get Restaurant Details
  // ----------------------------------------------------------------

  async getRestaurantDetails(
    vendorCode: string
  ): Promise<RestaurantDetails> {
    const path =
      `/api/v5/vendors/${encodeURIComponent(vendorCode)}` +
      `?include=menus,bundles,multiple_discounts` +
      `&language_id=${MARKET_CONFIG.languageId}&opening_type=delivery&basket_currency=${MARKET_CONFIG.currency}` +
      `&latitude=${this.latitude}&longitude=${this.longitude}`;

    interface VendorResponse {
      data: {
        code: string;
        name: string;
        address: string;
        rating: number;
        review_number: number;
        cuisines: Array<{ name: string; main: boolean }>;
        minimum_order_amount: number;
        minimum_delivery_fee: number;
        delivery_duration_range?: {
          lower_limit_in_minutes: number;
          upper_limit_in_minutes: number;
        };
        dynamic_pricing?: {
          delivery_fee?: { original: number };
          service_fee?: { total: number };
        };
        metadata?: { is_delivery_available: boolean };
        schedules: ScheduleEntry[];
        description: string;
        hero_image: string;
        logo: string;
        latitude: number;
        longitude: number;
        distance: number;
        menus?: VendorMenuData[];
      };
    }

    const result = await this.restRequest<VendorResponse>(path);
    const v = result.data;

    const cuisines = (v.cuisines || []).map((c) => c.name);
    const dr = v.delivery_duration_range;
    const deliveryTime = dr
      ? `${dr.lower_limit_in_minutes}-${dr.upper_limit_in_minutes} min`
      : "N/A";

    // Also cache the menu data while we have it
    if (v.menus && v.menus.length > 0) {
      this.cacheVendorMenu(v as VendorMenuInput);
    }

    return {
      id: v.code,
      name: v.name,
      cuisine: cuisines,
      rating: v.rating ?? 0,
      review_count: v.review_number ?? 0,
      delivery_fee: v.minimum_delivery_fee ?? 0,
      delivery_time: deliveryTime,
      minimum_order: v.minimum_order_amount ?? 0,
      distance_km: Math.round((v.distance ?? 0) * 10) / 10,
      is_open: v.metadata?.is_delivery_available ?? false,
      address: v.address ?? "",
      description: v.description ?? "",
      hero_image: v.hero_image ?? "",
      logo: v.logo ?? "",
      opening_hours: (v.schedules || []).map((s) => ({
        weekday: s.weekday,
        opening_type: s.opening_type,
        opening_time: s.opening_time,
        closing_time: s.closing_time,
      })),
      is_delivery_available: v.metadata?.is_delivery_available ?? false,
    };
  }

  // ----------------------------------------------------------------
  // 3. Get Menu
  // ----------------------------------------------------------------

  async getMenu(vendorCode: string): Promise<MenuCategory[]> {
    // Check cache first (15 min TTL)
    const cached = this.menuCache.get(vendorCode);
    if (cached && Date.now() - cached.cachedAt < MENU_CACHE_TTL_MS) {
      return cached.categories;
    }

    // Fetch via the vendor details endpoint (includes menus)
    const path =
      `/api/v5/vendors/${encodeURIComponent(vendorCode)}` +
      `?include=menus,bundles,multiple_discounts` +
      `&language_id=${MARKET_CONFIG.languageId}&opening_type=delivery&basket_currency=${MARKET_CONFIG.currency}` +
      `&latitude=${this.latitude}&longitude=${this.longitude}`;

    interface VendorMenuResponse {
      data: VendorMenuInput;
    }

    const result = await this.restRequest<VendorMenuResponse>(path);
    this.cacheVendorMenu(result.data);

    const cached2 = this.menuCache.get(vendorCode);
    return cached2 ? cached2.categories : [];
  }

  /**
   * Parse and cache menu data from a vendor API response.
   */
  private cacheVendorMenu(vendorData: VendorMenuInput): void {
    if (!vendorData.menus || vendorData.menus.length === 0) return;

    const menu = vendorData.menus[0];
    const toppingsDict = menu.toppings || {};
    const productsByCode = new Map<string, MenuItem>();
    const productsById = new Map<number, MenuItem>();
    const toppingOptionsById = new Map<
      number,
      { id: number; name: string; price: number }
    >();

    // Build flat topping option lookup
    for (const group of Object.values(toppingsDict)) {
      for (const opt of group.options || []) {
        toppingOptionsById.set(opt.id, {
          id: opt.id,
          name: opt.name,
          price: opt.price,
        });
      }
    }

    const categories: MenuCategory[] = (menu.menu_categories || []).map(
      (cat) => {
        const items: MenuItem[] = (cat.products || []).map((prod) => {
          const variation = prod.product_variations?.[0];

          // Resolve topping groups for this product variation
          const toppingGroups: ToppingGroup[] = [];
          if (variation?.topping_ids) {
            for (const tId of variation.topping_ids) {
              const group = toppingsDict[String(tId)];
              if (group) {
                toppingGroups.push({
                  id: group.id,
                  name: group.name,
                  quantity_minimum: group.quantity_minimum,
                  quantity_maximum: group.quantity_maximum,
                  options: (group.options || []).map((opt) => ({
                    id: opt.id,
                    product_id: opt.product_id,
                    name: opt.name,
                    price: opt.price,
                  })),
                });
              }
            }
          }

          // Replace %s placeholder in image URL with 300
          const imageUrl = prod.file_path
            ? prod.file_path.replace("%s", "300")
            : "";

          const item: MenuItem = {
            id: prod.id,
            code: prod.code,
            name: prod.name,
            description: prod.description || "",
            price: variation?.price ?? 0,
            image_url: imageUrl,
            is_sold_out: prod.is_sold_out ?? false,
            variation: variation
              ? {
                  id: variation.id,
                  code: variation.code,
                  price: variation.price,
                }
              : { id: 0, code: "", price: 0 },
            topping_groups: toppingGroups,
          };

          productsByCode.set(prod.code, item);
          productsById.set(prod.id, item);
          return item;
        });

        return { name: cat.name, items };
      }
    );

    this.menuCache.set(vendorData.code, {
      vendorCode: vendorData.code,
      vendorName: vendorData.name,
      vendorLatitude: vendorData.latitude,
      vendorLongitude: vendorData.longitude,
      categories,
      productsByCode,
      productsById,
      toppingOptionsById,
      cachedAt: Date.now(),
    });
  }

  // ----------------------------------------------------------------
  // 4. Add to Cart
  // ----------------------------------------------------------------

  async addToCart(
    vendorCode: string,
    items: AddToCartInput[]
  ): Promise<Cart> {
    // Ensure we have the menu cached for this vendor
    let cached = this.menuCache.get(vendorCode);
    if (!cached) {
      await this.getMenu(vendorCode);
      cached = this.menuCache.get(vendorCode);
      if (!cached) {
        throw new Error(
          `Could not load menu for vendor ${vendorCode}. The restaurant may not exist or may be unavailable.`
        );
      }
    }

    // If switching vendors, clear the cart
    if (this.cartVendor && this.cartVendor.code !== vendorCode) {
      this.clearCart();
    }

    // Set vendor info
    this.cartVendor = {
      code: vendorCode,
      latitude: cached.vendorLatitude,
      longitude: cached.vendorLongitude,
      marketplace: false,
      vertical: "restaurants",
    };
    this.cartVendorName = cached.vendorName;

    // Build product payloads for new items
    for (const input of items) {
      const product =
        cached.productsByCode.get(input.item_id) ||
        cached.productsById.get(Number(input.item_id));

      if (!product) {
        throw new Error(
          `Item "${input.item_id}" not found in menu for ${cached.vendorName}. Use get_menu to see available items.`
        );
      }

      // Build toppings payload
      const toppingsPayload: CartToppingPayload[] = [];

      if (input.topping_ids && input.topping_ids.length > 0) {
        // Group selected option IDs by their topping group
        const selectedOptionIds = new Set(
          input.topping_ids.map((id) => Number(id))
        );

        for (const group of product.topping_groups) {
          const selectedOptions = group.options.filter((opt) =>
            selectedOptionIds.has(opt.id)
          );
          if (selectedOptions.length > 0) {
            toppingsPayload.push({
              id: group.id,
              name: group.name,
              quantity: 1,
              options: selectedOptions.map((opt) => ({
                id: opt.id,
                name: opt.name,
                quantity: 1,
              })),
            });
          }
        }
      }

      const payload: CartProductPayload = {
        id: product.id,
        variation_id: product.variation.id,
        code: product.code,
        variation_code: product.variation.code,
        variation_name: product.name,
        quantity: input.quantity,
        price: product.variation.price,
        original_price: product.variation.price,
        packaging_charge: 0,
        vat_percentage: 0,
        special_instructions: input.special_instructions || "",
        sold_out_option: "REFUND",
        toppings: toppingsPayload,
        products: null,
        tags: null,
        menu_category_code: null,
        menu_category_id: null,
        menu_id: null,
        group_id: null,
        group_order_user_id: 0,
      };

      // Check if this product+variation already exists in cart
      const existingIdx = this.cartProducts.findIndex(
        (p) =>
          p.id === payload.id &&
          p.variation_id === payload.variation_id &&
          p.special_instructions === payload.special_instructions &&
          JSON.stringify(p.toppings) === JSON.stringify(payload.toppings)
      );

      if (existingIdx >= 0) {
        this.cartProducts[existingIdx].quantity += input.quantity;
      } else {
        this.cartProducts.push(payload);
        this.cartItemIds.push(`cart-${this.nextCartItemId++}`);
      }
    }

    // Call cart/calculate to validate and get pricing
    return this.calculateCart();
  }

  // ----------------------------------------------------------------
  // 5. Get Cart
  // ----------------------------------------------------------------

  async getCart(): Promise<Cart | null> {
    if (this.cartProducts.length === 0 || !this.cartVendor) {
      return null;
    }

    return {
      restaurant_id: this.cartVendor.code,
      restaurant_name: this.cartVendorName,
      items: this.cartItems,
      subtotal: this.cartSubtotal,
      delivery_fee: this.cartDeliveryFee,
      service_fee: this.cartServiceFee,
      total: this.cartTotal,
    };
  }

  // ----------------------------------------------------------------
  // 6. Remove from Cart
  // ----------------------------------------------------------------

  async removeFromCart(cartItemId: string): Promise<Cart> {
    const idx = this.cartItemIds.indexOf(cartItemId);
    if (idx < 0) {
      throw new Error(
        `Cart item "${cartItemId}" not found. Use get_cart to see current items.`
      );
    }

    // Remove the corresponding entries (all three arrays are aligned)
    this.cartProducts.splice(idx, 1);
    this.cartItemIds.splice(idx, 1);
    this.cartItems.splice(idx, 1);

    if (this.cartProducts.length === 0) {
      this.clearCart();
      return {
        restaurant_id: "",
        restaurant_name: "",
        items: [],
        subtotal: 0,
        delivery_fee: 0,
        service_fee: 0,
        total: 0,
      };
    }

    // Recalculate with remaining items
    return this.calculateCart();
  }

  // ----------------------------------------------------------------
  // 7. Preview Order
  // ----------------------------------------------------------------

  /** Cached checkout state from previewOrder, used by placeOrder */
  private checkoutState: {
    customer: CustomerProfile;
    address: DeliveryAddress;
    purchaseIntentId: string;
    paymentMethods: PaymentMethodInfo[];
  } | null = null;

  /** Cached customer profile (rarely changes) */
  private cachedCustomerProfile: CustomerProfile | null = null;

  private async getCustomerProfile(): Promise<CustomerProfile> {
    if (this.cachedCustomerProfile) return this.cachedCustomerProfile;

    const result = await this.restRequest<{
      data: {
        id: string;
        code: string;
        first_name: string;
        last_name: string;
        email: string;
        mobile_number: string;
        mobile_country_code: string;
      };
    }>("/api/v5/customers");

    this.cachedCustomerProfile = result.data;
    return result.data;
  }

  private async getDeliveryAddresses(): Promise<DeliveryAddress[]> {
    const result = await this.restRequest<{
      data: { items: DeliveryAddress[] };
    }>("/api/v5/customers/addresses");

    return result.data.items;
  }

  async listSavedAddresses(): Promise<SavedAddressSummary[]> {
    const addresses = await this.getDeliveryAddresses();

    return addresses.map((address) => ({
      id: address.id,
      label: address.label,
      formatted_address:
        address.formatted_customer_address ||
        address.formatted_address ||
        address.address_line1,
      city: address.city_name || address.city || "",
      latitude: address.latitude,
      longitude: address.longitude,
      delivery_instructions: address.delivery_instructions,
      is_delivery_available: address.is_delivery_available,
      selected: this.selectedDeliveryAddressId === address.id,
    }));
  }

  async selectDeliveryAddress(addressId: number): Promise<SavedAddressSummary> {
    const addresses = await this.getDeliveryAddresses();
    const address = addresses.find((item) => item.id === addressId);

    if (!address) {
      throw new Error(
        `Saved address "${addressId}" not found. Run \`${APP_NAME} addresses\` to see available address IDs.`
      );
    }

    this.selectedDeliveryAddressId = address.id;

    return {
      id: address.id,
      label: address.label,
      formatted_address:
        address.formatted_customer_address ||
        address.formatted_address ||
        address.address_line1,
      city: address.city_name || address.city || "",
      latitude: address.latitude,
      longitude: address.longitude,
      delivery_instructions: address.delivery_instructions,
      is_delivery_available: address.is_delivery_available,
      selected: true,
    };
  }

  public clearSelectedDeliveryAddress(): void {
    this.selectedDeliveryAddressId = null;
  }

  async getCurrentAddressInfo(): Promise<CurrentAddressInfo> {
    const addresses = await this.getDeliveryAddresses();
    const address =
      addresses.length > 0 ? this.pickDeliveryAddress(addresses) : null;

    return {
      selection_mode:
        this.selectedDeliveryAddressId === null ? "nearest" : "selected",
      selected_address_id: this.selectedDeliveryAddressId,
      location: this.getLocation(),
      address: address
        ? {
            id: address.id,
            label: address.label,
            formatted_address:
              address.formatted_customer_address ||
              address.formatted_address ||
              address.address_line1,
            city: address.city_name || address.city || "",
            latitude: address.latitude,
            longitude: address.longitude,
            delivery_instructions: address.delivery_instructions,
            is_delivery_available: address.is_delivery_available,
            selected: this.selectedDeliveryAddressId === address.id,
          }
        : null,
    };
  }

  /**
   * Pick the best delivery address: closest to configured lat/lng.
   */
  private pickDeliveryAddress(addresses: DeliveryAddress[]): DeliveryAddress {
    if (addresses.length === 0) {
      throw new Error(
        "No saved delivery addresses found. Please add an address in the foodpanda app first."
      );
    }

    if (this.selectedDeliveryAddressId !== null) {
      const selectedAddress = addresses.find(
        (address) => address.id === this.selectedDeliveryAddressId
      );

      if (!selectedAddress) {
        throw new Error(
          `Selected saved address "${this.selectedDeliveryAddressId}" was not found. Run \`${APP_NAME} addresses\` and select a valid address again.`
        );
      }

      return selectedAddress;
    }

    if (addresses.length === 1) return addresses[0];

    let best = addresses[0];
    let bestDist = Infinity;
    for (const addr of addresses) {
      const dlat = addr.latitude - this.latitude;
      const dlng = addr.longitude - this.longitude;
      const dist = dlat * dlat + dlng * dlng;
      if (dist < bestDist) {
        bestDist = dist;
        best = addr;
      }
    }
    return best;
  }

  private async getPurchaseIntent(
    vendorCode: string,
    subtotal: number,
    total: number
  ): Promise<{
    intentId: string;
    paymentMethods: PaymentMethodInfo[];
  }> {
    interface IntentResponse {
      data: {
        purchaseIntent: { id: string };
        paymentMethodDetails: {
          paymentMethods: Array<{
            name: string;
            hidden: boolean;
            isOnlinePaymentMethod: boolean;
            preferred: boolean;
            paymentInstruments: Array<{
              publicId: string;
              preferred: boolean;
              publicFields?: {
                displayValue?: string;
                bin?: string;
                owner?: string;
                validToMonth?: number;
                validToYear?: number;
                scheme?: string;
              };
            }> | null;
          }>;
        };
      };
    }

    const result = await this.restRequest<IntentResponse>(
      `/api/v5/purchase/intent?include=cashback&locale=${MARKET_CONFIG.locale}`,
      {
        method: "POST",
        body: JSON.stringify({
          subtotal,
          currency: MARKET_CONFIG.currency,
          vendorCode,
          amount: total,
          emoneyAmountToUse: 0,
          expeditionType: "delivery",
          paymentLimits: [
            { limitCode: "foodafterdiscount", limitAmount: subtotal },
            { limitCode: "orderamountwithoutpaymentfee", limitAmount: total },
          ],
        }),
      }
    );

    const intentId = result.data.purchaseIntent.id;
    const methods: PaymentMethodInfo[] = [];

    for (const pm of result.data.paymentMethodDetails.paymentMethods) {
      if (
        pm.hidden ||
        !MARKET_CONFIG.supportedPreviewPaymentMethodNames.includes(pm.name)
      ) {
        continue;
      }

      if (pm.name === MARKET_CONFIG.cashOnDeliveryMethod) {
        const instrument = pm.paymentInstruments?.[0];
        methods.push({
          name: MARKET_CONFIG.cashOnDeliveryMethod,
          display_name: "Cash on Delivery",
          instrument_id: instrument?.publicId ?? null,
        });
      }
    }

    return { intentId, paymentMethods: methods };
  }

  async previewOrder(): Promise<OrderPreview> {
    if (this.cartProducts.length === 0 || !this.cartVendor) {
      throw new Error("Cart is empty. Add items before previewing an order.");
    }

    // Check if the restaurant is currently open for delivery
    const vendorDetails = await this.getRestaurantDetails(this.cartVendor.code);
    if (!vendorDetails.is_open || !vendorDetails.is_delivery_available) {
      throw new Error(
        `${vendorDetails.name} is currently closed or not accepting delivery orders. Please try again during their operating hours.`
      );
    }

    const [customer, addresses, intent] = await Promise.all([
      this.getCustomerProfile(),
      this.getDeliveryAddresses(),
      this.getPurchaseIntent(
        this.cartVendor.code,
        this.cartSubtotal,
        this.cartTotal
      ),
    ]);

    const address = this.pickDeliveryAddress(addresses);

    // Cache for placeOrder
    this.checkoutState = {
      customer,
      address,
      purchaseIntentId: intent.intentId,
      paymentMethods: intent.paymentMethods,
    };

    return {
      cart: {
        restaurant_id: this.cartVendor.code,
        restaurant_name: this.cartVendorName,
        items: this.cartItems,
        subtotal: this.cartSubtotal,
        delivery_fee: this.cartDeliveryFee,
        service_fee: this.cartServiceFee,
        total: this.cartTotal,
      },
      delivery_address: {
        id: address.id,
        label: address.label,
        formatted_address: address.formatted_customer_address,
        delivery_instructions: address.delivery_instructions,
      },
      payment_methods: intent.paymentMethods,
    };
  }

  // ----------------------------------------------------------------
  // 8. Place Order
  // ----------------------------------------------------------------

  async placeOrder(
    paymentMethodName: string,
    deliveryInstructions?: string
  ): Promise<OrderResult> {
    if (!this.checkoutState) {
      throw new Error(
        "No order preview found. Run preview before placing an order."
      );
    }
    if (this.cartProducts.length === 0 || !this.cartVendor) {
      throw new Error("Cart is empty.");
    }

    await this.calculateCart();

    const { customer, address, purchaseIntentId, paymentMethods } =
      this.checkoutState;

    const selectedMethod = paymentMethods.find(
      (method) => method.name === paymentMethodName
    );
    if (!selectedMethod) {
      const available = paymentMethods.map((method) => method.name).join(", ");
      throw new Error(
        `Payment method "${paymentMethodName}" not available. Available: ${available}`
      );
    }

    if (selectedMethod.name !== MARKET_CONFIG.cashOnDeliveryMethod) {
      throw new Error(
        `Only ${MARKET_CONFIG.cashOnDeliveryMethod} is currently supported for live checkout in this CLI.`
      );
    }

    const paymentMethodsPayload = [
      {
        amount: this.cartTotal,
        metadata: {
          token: selectedMethod.instrument_id,
        },
        method: MARKET_CONFIG.cashOnDeliveryMethod,
      },
    ];

    const cached = this.menuCache.get(this.cartVendor.code);
    const checkoutProducts = this.cartProducts.map((product) => {
      const menuItem = cached?.productsById.get(product.id);
      return {
        description: menuItem?.description ?? "",
        priceBeforeDiscount: null,
        name: menuItem?.name ?? product.variation_name,
        vat_percentage: product.vat_percentage,
        discount: null,
        special_instructions: product.special_instructions,
        variation_name: "",
        sold_out_option: product.sold_out_option,
        toppings: product.toppings,
        price: product.price,
        packaging_price: product.packaging_charge,
        original_price: product.original_price,
        quantity: product.quantity,
        quantity_auto_added: 0,
        id: product.id,
        variation_id: product.variation_id,
        is_available: true,
        is_alcoholic_item: false,
        total_price: product.price * product.quantity,
        total_price_before_discount: product.price * product.quantity,
        products: [],
        product_variation_id: product.variation_id,
        product_id: product.id,
        sold_out_options: [
          { default: true, option: "REFUND", text: "NEXTGEN_SoldOutOptions_Refund" },
          { default: false, option: "CALL_CUSTOMER", text: "NEXTGEN_SoldOutOptions_CALL_CUSTOMER" },
        ],
        product_variations: [
          {
            id: product.variation_id,
            code: product.variation_code,
            remote_code: product.variation_code,
            container_price: 0,
            price: product.price,
            topping_ids: product.toppings.map((topping) => topping.id),
            topping_properties: [],
            unit_pricing: null,
            total_price: 0,
            dietary_attributes: {},
          },
        ],
        code: product.code,
        variation_code: product.variation_code,
        is_bundle: false,
        tags: [],
        imageUrl: menuItem?.image_url ?? "",
        initial_price: product.price,
        initial_original_price: product.original_price,
        product_type: "",
      };
    });

    const dpsPayload = {
      session_id: Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join(""),
      perseus_id: this.perseusClientId,
      timestamp: Math.floor(Date.now() / 1000),
    };
    const dpsSessionId = Buffer.from(JSON.stringify(dpsPayload)).toString("base64");

    const checkoutBody = {
      platform: "b2c",
      expected_total_amount: this.cartTotal,
      customer: {
        id: customer.id,
        email: customer.email,
        address_id: String(address.id),
        age_verification_token: "",
      },
      expedition: {
        delivery_address: {
          ...address,
          id: String(address.id),
          type: String(address.type),
          location_type: "polygon",
          object_type: "saved address",
        },
        type: "delivery",
        latitude: address.latitude,
        longitude: address.longitude,
        instructions: deliveryInstructions ?? "",
        delivery_instructions_tags: [] as string[],
        delivery_option: "standard",
      },
      order_time: "now",
      source: "volo",
      vendor: this.cartVendor,
      products: checkoutProducts,
      payment: {
        client_redirect_url: MARKET_CONFIG.paymentRedirectUrl,
        purchase_intent_id: purchaseIntentId,
        currency: MARKET_CONFIG.currency,
        methods: paymentMethodsPayload,
      },
      voucher: "",
      voucher_context: { construct_id: "" },
      bypass_duplicate_order_check: false,
      supported_features: {
        support_banned_products_soft_fail: true,
        small_order_fee_enabled: true,
        "pd-tx-cash-to-online-payment-surcharge": false,
      },
      joker_offer_id: "",
      joker: { single_discount: true },
    };

    interface CheckoutResponse {
      id?: string;
      order?: {
        code?: string;
        order_code?: string;
        status?: string;
        estimated_delivery_time?: string;
      };
      code?: string;
      order_code?: string;
      status?: string;
      data?: {
        order_code?: string;
        code?: string;
        status?: string;
      };
      payment?: {
        result?: string;
        purchase_id?: string;
        action?: string | null;
        reason?: string;
      };
      expedition?: {
        expected_delivery_duration?: number;
      };
      redirect_url?: string;
      errors?: Array<{ message?: string; code?: string }>;
      error?: string;
      message?: string;
    }

    const result = await this.restRequest<CheckoutResponse>(
      "/api/v5/cart/checkout",
      {
        method: "POST",
        body: JSON.stringify(checkoutBody),
        headers: {
          "dps-session-id": dpsSessionId,
          "x-caller-platform": "mfe",
          "x-global-entity-id": MARKET_CONFIG.globalEntityId,
        },
      }
    );

    console.error("[placeOrder] checkout response:", JSON.stringify(result, null, 2));

    if (result.errors && result.errors.length > 0) {
      const messages = result.errors
        .map((error) => error.message || error.code || "unknown error")
        .join("; ");
      throw new Error(`Checkout failed: ${messages}`);
    }
    if (result.error) {
      throw new Error(`Checkout failed: ${result.error}`);
    }
    if (result.message && !result.order && !result.code && !result.order_code && !result.data) {
      throw new Error(`Checkout failed: ${result.message}`);
    }

    if (result.redirect_url) {
      throw new Error(
        `Payment requires browser authentication. Please complete payment at: ${result.redirect_url}`
      );
    }

    const orderCode =
      result.id ??
      result.order?.code ??
      result.order?.order_code ??
      result.code ??
      result.order_code ??
      result.data?.order_code ??
      result.data?.code ??
      null;

    if (!orderCode) {
      console.error("[placeOrder] no order code found in response:", JSON.stringify(result));
      throw new Error(
        "Order may not have been placed: no order code was returned. Check your foodpanda app or website to confirm."
      );
    }

    const status =
      result.payment?.result ??
      result.order?.status ??
      result.status ??
      result.data?.status ??
      "placed";

    const finalTotal = checkoutBody.expected_total_amount;
    const deliveryMinutes = result.expedition?.expected_delivery_duration ?? 0;
    const estimatedDelivery =
      result.order?.estimated_delivery_time ??
      (deliveryMinutes > 0 ? `${deliveryMinutes} min` : "");

    this.clearCart();
    this.checkoutState = null;

    return {
      order_id: orderCode,
      status,
      estimated_delivery_time: estimatedDelivery,
      total: finalTotal,
    };
  }

  // ----------------------------------------------------------------
  // Cart calculation helper
  // ----------------------------------------------------------------

  private async calculateCart(): Promise<Cart> {
    if (!this.cartVendor || this.cartProducts.length === 0) {
      throw new Error("Cart is empty. Add items first.");
    }

    const requestBody: CartCalculateRequest = {
      products: this.cartProducts,
      vendor: this.cartVendor,
      expedition: {
        type: "delivery",
        delivery_option: "standard",
        latitude: this.latitude,
        longitude: this.longitude,
      },
      voucher: "",
      voucher_context: null,
      auto_apply_voucher: false,
      joker: { single_discount: true },
      joker_offer_id: "",
      payment: { version: 1 },
      group_order: null,
      source: "",
      order_time: "",
      participants: [],
      items: null,
    };

    interface CalculateResponse {
      products: Array<{
        id: number;
        variation_id: number;
        price: number;
        original_price: number;
        quantity: number;
        is_available: boolean;
        variation_name: string;
      }>;
      expedition: {
        delivery_fee: number;
        original_delivery_fee: number;
        selected_delivery_option?: {
          delivery_fee: number;
        };
      };
      payment: {
        subtotal: number;
        service_fee: number;
        total: number;
      };
    }

    const result = await this.restRequest<CalculateResponse>(
      "/api/v5/cart/calculate?include=expedition",
      {
        method: "POST",
        body: JSON.stringify(requestBody),
      }
    );

    // Update local cart state from server response
    this.cartSubtotal = result.payment?.subtotal ?? 0;
    this.cartServiceFee = result.payment?.service_fee ?? 0;
    this.cartTotal = result.payment?.total ?? 0;
    this.cartDeliveryFee =
      result.expedition?.selected_delivery_option?.delivery_fee ??
      result.expedition?.delivery_fee ??
      0;

    // Rebuild cartItems from the response + our stored payloads
    const cached = this.menuCache.get(this.cartVendor!.code);
    this.cartItems = this.cartProducts.map((payload, idx) => {
      // Match server response by (id, variation_id) instead of index
      const serverProduct = result.products?.find(
        (sp) => sp.id === payload.id && sp.variation_id === payload.variation_id
      );
      const quantity = serverProduct?.quantity ?? payload.quantity;
      const unitPrice = serverProduct?.price ?? payload.price;

      // Resolve topping names from flat lookup map
      const toppingDetails: Array<{
        id: number;
        name: string;
        price: number;
      }> = [];
      if (cached) {
        for (const tGroup of payload.toppings) {
          for (const tOpt of tGroup.options) {
            const opt = cached.toppingOptionsById.get(tOpt.id);
            if (opt) {
              toppingDetails.push(opt);
            }
          }
        }
      }

      return {
        cart_item_id: this.cartItemIds[idx],
        product_id: payload.id,
        variation_id: payload.variation_id,
        code: payload.code,
        name: payload.variation_name,
        quantity,
        unit_price: unitPrice,
        total_price: unitPrice * quantity,
        toppings: toppingDetails,
        special_instructions: payload.special_instructions,
      };
    });

    return {
      restaurant_id: this.cartVendor.code,
      restaurant_name: this.cartVendorName,
      items: this.cartItems,
      subtotal: this.cartSubtotal,
      delivery_fee: this.cartDeliveryFee,
      service_fee: this.cartServiceFee,
      total: this.cartTotal,
    };
  }

  private clearCart(): void {
    this.cartProducts = [];
    this.cartItemIds = [];
    this.cartVendor = null;
    this.cartVendorName = "";
    this.cartItems = [];
    this.cartSubtotal = 0;
    this.cartDeliveryFee = 0;
    this.cartServiceFee = 0;
    this.cartTotal = 0;
    this.nextCartItemId = 1;
  }

  /** Serialize all mutable state for persistence between CLI commands */
  public serialize(): SerializedState {
    const menuEntries: SerializedState["menuCache"] = [];
    for (const [key, cached] of this.menuCache) {
      menuEntries.push({
        key,
        value: {
          vendorCode: cached.vendorCode,
          vendorName: cached.vendorName,
          vendorLatitude: cached.vendorLatitude,
          vendorLongitude: cached.vendorLongitude,
          categories: cached.categories,
          productsByCode: Array.from(cached.productsByCode.entries()),
          productsById: Array.from(cached.productsById.entries()),
          toppingOptionsById: Array.from(cached.toppingOptionsById.entries()),
          cachedAt: cached.cachedAt,
        },
      });
    }

    return {
      cartProducts: this.cartProducts,
      cartItemIds: this.cartItemIds,
      cartVendor: this.cartVendor,
      cartVendorName: this.cartVendorName,
      cartItems: this.cartItems,
      cartSubtotal: this.cartSubtotal,
      cartDeliveryFee: this.cartDeliveryFee,
      cartServiceFee: this.cartServiceFee,
      cartTotal: this.cartTotal,
      nextCartItemId: this.nextCartItemId,
      menuCache: menuEntries,
      checkoutState: this.checkoutState,
      cachedCustomerProfile: this.cachedCustomerProfile,
      selectedDeliveryAddressId: this.selectedDeliveryAddressId,
    };
  }

  /** Restore mutable state from a serialized snapshot */
  public deserialize(state: SerializedState): void {
    this.cartProducts = state.cartProducts;
    this.cartItemIds = state.cartItemIds;
    this.cartVendor = state.cartVendor;
    this.cartVendorName = state.cartVendorName;
    this.cartItems = state.cartItems;
    this.cartSubtotal = state.cartSubtotal;
    this.cartDeliveryFee = state.cartDeliveryFee;
    this.cartServiceFee = state.cartServiceFee;
    this.cartTotal = state.cartTotal;
    this.nextCartItemId = state.nextCartItemId;
    this.checkoutState = state.checkoutState;
    this.cachedCustomerProfile = state.cachedCustomerProfile;
    this.selectedDeliveryAddressId = state.selectedDeliveryAddressId ?? null;

    // Rebuild Maps from serialized arrays
    this.menuCache = new Map();
    const now = Date.now();
    for (const entry of state.menuCache) {
      // Skip expired cache entries
      if (now - entry.value.cachedAt > MENU_CACHE_TTL_MS) continue;
      this.menuCache.set(entry.key, {
        vendorCode: entry.value.vendorCode,
        vendorName: entry.value.vendorName,
        vendorLatitude: entry.value.vendorLatitude,
        vendorLongitude: entry.value.vendorLongitude,
        categories: entry.value.categories,
        productsByCode: new Map(entry.value.productsByCode),
        productsById: new Map(entry.value.productsById),
        toppingOptionsById: new Map(entry.value.toppingOptionsById),
        cachedAt: entry.value.cachedAt,
      });
    }
  }
}
