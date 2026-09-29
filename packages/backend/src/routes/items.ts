import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { appConfig } from "../db/schema.js";
import { requireAuth } from "../lib/auth.js";
import { getPublicGoodwillClient } from "../lib/goodwill.js";

/**
 * Response for GET /api/items/:id/shipping-quote.
 *
 * `source` distinguishes how the numbers were derived:
 *  - "flat"     — item has a fixed shipping price; no destination needed
 *  - "calc"     — item required a live calculation against the configured address
 *  - "no-address" — item needs a calc but the user hasn't configured one yet
 */
export interface ShippingQuoteResponse {
  source: "flat" | "calc" | "no-address";
  handling: number;
  shipping: number;
  total: number;
  carrier?: string;
  method?: string;
}

export const itemRoutes = new Hono();
itemRoutes.use("*", requireAuth);

itemRoutes.get("/:id/shipping-quote", async (c) => {
  const rawId = c.req.param("id");
  const itemId = Number(rawId);
  if (!Number.isFinite(itemId)) return c.json({ error: "invalid_id" }, 400);

  const client = getPublicGoodwillClient();
  let detail;
  try {
    detail = await client.items.get(itemId);
  } catch (err) {
    return c.json(
      { error: "item_fetch_failed", message: (err as Error).message },
      502,
    );
  }

  const handlingFromItem = detail.handlingPrice ?? 0;

  if (!detail.allowShippingCalculation) {
    const shipping = detail.shippingPrice ?? 0;
    return c.json<ShippingQuoteResponse>({
      source: "flat",
      handling: handlingFromItem,
      shipping,
      total: handlingFromItem + shipping,
    });
  }

  const [cfg] = await db.select().from(appConfig).where(eq(appConfig.id, 1));
  if (!cfg?.shippingZip || !cfg.shippingCountry) {
    return c.json<ShippingQuoteResponse>({
      source: "no-address",
      handling: handlingFromItem,
      shipping: 0,
      total: handlingFromItem,
    });
  }

  try {
    const quote = await client.shipping.calculate({
      itemId,
      country: cfg.shippingCountry,
      province: cfg.shippingState ?? null,
      zipCode: cfg.shippingZip,
    });
    return c.json<ShippingQuoteResponse>({
      source: "calc",
      handling: quote.handling,
      shipping: quote.shipping,
      total: quote.total,
      ...(quote.carrier ? { carrier: quote.carrier } : {}),
      ...(quote.method ? { method: quote.method } : {}),
    });
  } catch (err) {
    return c.json(
      { error: "quote_failed", message: (err as Error).message },
      502,
    );
  }
});
