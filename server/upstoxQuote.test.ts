import { describe, expect, it } from "vitest";
import { selectRequestedUpstoxQuote } from "./upstoxQuote";

describe("selectRequestedUpstoxQuote", () => {
  it("accepts an official V2 symbol-keyed response when instrument_token matches", () => {
    const quote = selectRequestedUpstoxQuote(
      {
        "NSE_EQ:NHPC": {
          instrument_token: "NSE_EQ|INE848E01016",
          last_price: 52.05,
        },
      },
      "NSE_EQ|INE848E01016",
    );

    expect(quote?.last_price).toBe(52.05);
  });

  it("rejects the first response object when it belongs to a different instrument", () => {
    const quote = selectRequestedUpstoxQuote(
      {
        "MCX_FO:CRUDEOIL FUT": {
          instrument_token: "MCX_FO|UNDERLYING",
          last_price: 8150,
        },
        "MCX_FO:CRUDEOIL PE": {
          instrument_token: "MCX_FO|REQUESTED_OPTION",
          last_price: 530.5,
        },
      },
      "MCX_FO|REQUESTED_OPTION",
    );

    expect(quote?.last_price).toBe(530.5);
  });

  it("rejects a response with no matching instrument identity", () => {
    expect(
      selectRequestedUpstoxQuote(
        {
          "MCX_FO:CRUDEOIL FUT": {
            instrument_token: "MCX_FO|UNDERLYING",
            last_price: 8150,
          },
        },
        "MCX_FO|REQUESTED_OPTION",
      ),
    ).toBeNull();
  });

  it("rejects a quote that omits the authoritative instrument_token", () => {
    expect(
      selectRequestedUpstoxQuote(
        { "MCX_FO:UNKNOWN": { last_price: 17 } },
        "MCX_FO|REQUESTED_OPTION",
      ),
    ).toBeNull();
  });

  it("rejects an ambiguous response with duplicate matching identities", () => {
    expect(
      selectRequestedUpstoxQuote(
        {
          first: { instrument_token: "MCX_FO|REQUESTED_OPTION", last_price: 17 },
          second: { instrument_token: "MCX_FO|REQUESTED_OPTION", last_price: 530.5 },
        },
        "MCX_FO|REQUESTED_OPTION",
      ),
    ).toBeNull();
  });
});
