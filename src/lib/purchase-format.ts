export function displayDate(iso: string) {
  return new Intl.DateTimeFormat("lt-LT", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

export function displayPrice(price: string, currency: string) {
  const [whole, cents] = price.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")},${cents}\u00a0${currency}`;
}
