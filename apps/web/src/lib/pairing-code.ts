/** Accept the same code when typed lowercase or pasted with visual separators. */
export function normalizePairingCode(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function validPairingCode(value: string): boolean {
  return /^[A-Z0-9]{8}$/.test(value);
}
