export function formatOcean(amount: bigint, decimals = 18): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;

  const fractional = remainder.toString().padStart(decimals, '0');
  const trimmedFractional = fractional.slice(0, 2); // Only 2 decimal places

  // Add thousands separators to whole number
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (trimmedFractional === '00' || trimmedFractional === '') {
    return wholeStr;
  }

  return `${wholeStr}.${trimmedFractional}`;
}

export function oceanToNumber(amount: bigint, decimals = 18): number {
  const divisor = 10n ** BigInt(decimals);
  const whole = Number(amount / divisor);
  const remainder = Number(amount % divisor);
  return whole + (remainder / Number(divisor));
}

export function parseOcean(amount: string, decimals = 18): bigint {
  const [whole, fractional = ''] = amount.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFractional);
}
