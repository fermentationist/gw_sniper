import type { Transport } from "./http.js";
import type { BidFailureReason, BidResult, RequestOptions } from "./types.js";

export interface BidsApi {
  /**
   * Being outbid or arriving late are expected outcomes, not exceptions —
   * only transport/auth failures throw. The body is authoritative, don't
   * infer success from a 200.
   */
  place(
    params: { itemId: number; amount: number },
    req?: RequestOptions,
  ): Promise<BidResult>;
}

function classifyFailure(message: string): BidFailureReason {
  const m = message.toLowerCase();
  if (m.includes("outbid") || m.includes("higher")) return "outbid";
  if (m.includes("minimum") || m.includes("increment") || m.includes("below"))
    return "below-minimum";
  if (m.includes("ended") || m.includes("closed") || m.includes("expired"))
    return "auction-ended";
  if (m.includes("restrict") || m.includes("suspend") || m.includes("blocked"))
    return "account-restricted";
  return "unknown";
}

export function createBidsApi(transport: Transport): BidsApi {
  return {
    async place(params, req) {
      const raw = await transport.request<Record<string, unknown>>({
        method: "POST",
        path: "/ItemBid/PlaceBid",
        body: { itemId: params.itemId, bidAmount: params.amount },
        auth: true,
        options: { priority: "high", ...req },
      });

      // The API responds with a bag of loosely-typed flags. Normalise.
      const successFlag =
        raw["success"] === true ||
        raw["isSuccess"] === true ||
        raw["status"] === "success" ||
        raw["statusCode"] === 0;
      const message =
        (typeof raw["message"] === "string" && raw["message"]) ||
        (typeof raw["msg"] === "string" && raw["msg"]) ||
        (typeof raw["errorMessage"] === "string" && raw["errorMessage"]) ||
        "";

      const currentPrice = numFrom(raw["currentPrice"], raw["highBidAmount"]);
      const highBidder =
        raw["isHighBidder"] === true ||
        raw["highBidder"] === true ||
        raw["isWinning"] === true;

      if (successFlag) {
        return {
          ok: true,
          itemId: params.itemId,
          amount: params.amount,
          currentPrice,
          highBidder: Boolean(highBidder),
          raw,
        };
      }
      return {
        ok: false,
        itemId: params.itemId,
        reason: classifyFailure(message),
        message: message || "Bid rejected",
        raw,
      };
    },
  };
}

function numFrom(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}
