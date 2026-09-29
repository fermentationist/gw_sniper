import { ResponseShapeError } from "./errors.js";
import type { Transport } from "./http.js";
import type { RequestOptions, ShippingQuote } from "./types.js";

export interface ShippingCalcParams {
  itemId: number | string;
  /** Two-letter ISO country code (e.g. "US"). @default "US" */
  country?: string;
  /** Two-letter US state code; null for anywhere the site doesn't require it. */
  province?: string | null;
  zipCode: string;
  quantity?: number;
}

export interface ShippingApi {
  /**
   * POST /ItemDetail/CalculateShipping. The site returns an HTML fragment like:
   *
   *   <p>Estimated Shipping and Handling:</p>
   *   <p>Shipping: <span id='shipping-span'>$14.81 (GROUND_HOME_DELIVERY)</span></p>
   *   <p>Handling: $2.00</p>
   *   <p><b>Total Shipping and Handling: $16.81</b></p>
   *
   * …which we regex-parse into a {@link ShippingQuote}.
   */
  calculate(
    params: ShippingCalcParams,
    req?: RequestOptions,
  ): Promise<ShippingQuote>;
}

export function createShippingApi(transport: Transport): ShippingApi {
  return {
    async calculate(params, req) {
      const html = await transport.request<string>({
        method: "POST",
        path: "/ItemDetail/CalculateShipping",
        body: {
          itemId: Number(params.itemId),
          country: params.country ?? "US",
          province: params.province ?? null,
          zipCode: params.zipCode,
          quantity: params.quantity ?? 1,
          clientIP: "",
        },
        responseType: "text",
        options: req,
      });
      return parseShippingHtml(html);
    },
  };
}

const AMOUNT = /\$([\d,]+(?:\.\d{1,2})?)/;

function parseAmount(source: string): number | undefined {
  const m = AMOUNT.exec(source);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function parseShippingHtml(html: string): ShippingQuote {
  const shippingMatch = /Shipping:\s*(?:<[^>]*>)*\s*\$[\d,]+(?:\.\d{1,2})?(?:\s*\(([^)]+)\))?/i.exec(
    html,
  );
  const totalMatch = /Total Shipping and Handling:\s*(?:<[^>]*>)*\s*\$([\d,]+(?:\.\d{1,2})?)/i.exec(
    html,
  );
  const handlingMatch = /Handling:\s*\$([\d,]+(?:\.\d{1,2})?)/i.exec(html);
  const carrierMatch = /Shipping Carrier:\s*([^<\n]+?)\s*(?:<|$)/i.exec(html);

  const shipping = shippingMatch ? parseAmount(shippingMatch[0]) : undefined;
  const handling = handlingMatch ? Number(handlingMatch[1]!.replace(/,/g, "")) : undefined;
  const total = totalMatch ? Number(totalMatch[1]!.replace(/,/g, "")) : undefined;

  if (shipping === undefined && handling === undefined && total === undefined) {
    throw new ResponseShapeError({
      path: "/ItemDetail/CalculateShipping",
      responseBody: html,
      issues: ["no recognizable $amount for shipping, handling, or total"],
    });
  }

  const s = shipping ?? (total !== undefined && handling !== undefined ? total - handling : 0);
  const h = handling ?? (total !== undefined && shipping !== undefined ? total - shipping : 0);
  const t = total ?? s + h;

  return {
    shipping: s,
    handling: h,
    total: t,
    carrier: carrierMatch ? carrierMatch[1]!.trim() : undefined,
    method: shippingMatch && shippingMatch[1] ? shippingMatch[1].trim() : undefined,
    rawHtml: html,
  };
}
