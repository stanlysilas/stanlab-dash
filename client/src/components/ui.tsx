import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { cn } from "../lib/utils";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
}) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101214] disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "bg-lime-400 text-[#111510] hover:bg-lime-300",
        variant === "outline" &&
          "border border-lime-400/75 text-lime-300 hover:bg-lime-400/10",
        variant === "ghost" &&
          "text-zinc-300 hover:bg-white/5 hover:text-white",
        className,
      )}
      {...props}
    />
  );
}

export function Field(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-12 w-full rounded-md border border-[#3a3f46] bg-[#111315] px-3.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/15",
        props.className,
      )}
    />
  );
}

export function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-md border border-[#3a3f46] bg-[#141619]/75 px-6 py-5 sm:px-7 sm:py-6",
        className,
      )}
    >
      <h2 className="text-xl font-semibold tracking-[-0.025em] text-zinc-100">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Notice({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "success";
}) {
  return (
    <p
      className={cn(
        "text-sm leading-6",
        tone === "neutral" && "text-zinc-400",
        tone === "warning" && "text-amber-300",
        tone === "success" && "text-lime-300",
      )}
    >
      {children}
    </p>
  );
}
