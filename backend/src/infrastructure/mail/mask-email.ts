/** `jane.doe@example.com` -> `j***@example.com`: enough to correlate, not to identify. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) {
    return '***';
  }
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}
