import type { Transport } from "./http.js";
import type { RequestOptions, ShippingQuote } from "./types.js";

export interface ShippingApi {
  quote(
    params: { itemId: number | string; zipCode: string },
    req?: RequestOptions,
  ): Promise<ShippingQuote>;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function createShippingApi(transport: Transport): ShippingApi {
  return {
    async quote(params, req) {
      const raw = await transport.request<Record<string, unknown>>({
        method: "POST",
        path: "/ItemDetail/CalculateShipping",
        body: {
          itemId: String(params.itemId),
          country: "US",
          province: "",
          zipCode: params.zipCode,
          quantity: 1,
          clientIP: "0.0.0.4",
        },
        options: req,
      });

      const nested =
        (raw["shipping"] as Record<string, unknown> | undefined) ?? raw;
      const shipping = num(nested["shipping"]) ?? num(nested["shippingAmount"]) ?? 0;
      const handling = num(nested["handling"]) ?? num(nested["handlingFee"]) ?? 0;
      const total =
        num(nested["total"]) ??
        num(nested["totalCost"]) ??
        shipping + handling;
      return { shipping, handling, total, raw };
    },
  };
}
