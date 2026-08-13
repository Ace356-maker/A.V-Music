/** Une clases CSS descartando valores vacíos. Alternativa ligera a clsx. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
