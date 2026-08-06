export function validChapterNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

export function sanitizeChapterInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "").replace(/^0$/, "");
}
