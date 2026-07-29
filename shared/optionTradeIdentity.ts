export interface OptionTradeDescriptor {
  isIndexOptions?: boolean | null;
  symbol?: string | null;
  symbolLabel?: string | null;
}

const OPTION_SIDE_TOKEN = /(?:^|[^A-Z0-9])(?:CE|PE)(?=$|[^A-Z0-9])/i;
const OPTION_WORD_TOKEN = /(?:^|[^A-Z0-9])(?:CALL|PUT)(?=$|[^A-Z0-9])/i;

/**
 * Identifies an option contract from durable trade descriptors.
 *
 * Session-level `isIndexOptions` can be stale or absent after a stop/redeploy,
 * while persisted option rows still carry contract labels such as
 * `CRUDEOIL 17AUG26 8150 PE` or symbols such as `CRUDEOIL_PE_8150`.
 */
export function isOptionTrade({
  isIndexOptions,
  symbol,
  symbolLabel,
}: OptionTradeDescriptor): boolean {
  if (isIndexOptions === true) return true;

  return [symbol, symbolLabel].some(value =>
    typeof value === "string"
      && (OPTION_SIDE_TOKEN.test(value) || OPTION_WORD_TOKEN.test(value)),
  );
}

export function getOptionSide(
  descriptor: Pick<OptionTradeDescriptor, "symbol" | "symbolLabel">,
): "CE" | "PE" | null {
  for (const value of [descriptor.symbol, descriptor.symbolLabel]) {
    if (typeof value !== "string") continue;
    const match = value.match(/(?:^|[^A-Z0-9])(CE|PE)(?=$|[^A-Z0-9])/i);
    if (match) return match[1].toUpperCase() as "CE" | "PE";
  }
  return null;
}
