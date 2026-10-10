/**
 * Serialises JSON-LD for inlining in a <script> tag. `JSON.stringify` does not
 * escape `<`, so a value containing `</script>` would end the tag early; `<` (and
 * the two line separators that break some parsers) are written as unicode escapes,
 * which JSON parsers read back as the same characters.
 */
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}
