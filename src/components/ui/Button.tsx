import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** true = botón ocupado (escaneando, importando): se pinta BLANCO con
   * halo y SIN borde (el borde morado desaparece), sin atenuarse, y el
   * cursor indica espera. */
  busy?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  // Primario SIN fondo y SIN borde: solo texto blanco (ink) — sin morado y
  // sin contorno; el blanco se insinúa, nunca rellena ni bordea el botón.
  primary: "text-ink",
  secondary: "text-ink",
  ghost: "text-muted",
};

export function Button({ variant = "primary", busy = false, className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-sm px-4 py-2 text-sm font-medium transition-colors duration-150 ease-out",
        // Ocupado: sin borde (igual que el normal, el ancho NO cambia),
        // texto blanco con halo (text-shadow, sigue las letras) y cursor de
        // espera. La atenuación por disabled NO aplica.
        busy
          ? "cursor-wait text-ink text-shadow-[0_0_10px_color-mix(in_srgb,white_40%,transparent)]"
          : `disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]}`,
        className,
      )}
      {...props}
    />
  );
}
