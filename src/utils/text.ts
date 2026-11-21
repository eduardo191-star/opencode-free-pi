/** Text helpers shared by ads and sign-in. */

export function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()
    : "";
}
