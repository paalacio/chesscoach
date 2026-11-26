// Small in-house controls built on unstyled Radix primitives (styles in components.css).

import * as Dialog from "@radix-ui/react-dialog";
import * as RadixSwitch from "@radix-ui/react-switch";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { backend } from "../../backend";

/** "⌘E" on Mac, "Ctrl+E" on Windows. `shift` adds ⇧ / Shift+. */
export function shortcut(key: string, opts: { shift?: boolean } = {}): string {
  if (backend.platform === "mac") return `${opts.shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${opts.shift ? "Shift+" : ""}${key}`;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary"; size?: "small" | "large" };

export function Button({ variant, size, className = "", ...rest }: BtnProps) {
  return <button type="button" className={`btn ${variant ?? ""} ${size ?? ""} ${className}`} {...rest} />;
}

/** Borderless toolbar button with an icon (and an optional label). */
export function IconButton({
  label,
  showLabel,
  pressed,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; showLabel?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} aria-pressed={pressed} {...rest}>
      {children}
      {showLabel && <span className="label">{label}</span>}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className="segmented"
      value={value}
      aria-label={label}
      onValueChange={(v) => v && onChange(v as T)}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value}>
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <RadixSwitch.Root className="switch" checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled}>
      <RadixSwitch.Thumb className="thumb" />
    </RadixSwitch.Root>
  );
}

/** A macOS-style sheet: slides down from the toolbar, dims the window. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  wide,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className={`sheet ${wide ? "wide" : ""}`} aria-describedby={undefined}>
          <div className="sheet-body">
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            {description && <p className="sheet-desc">{description}</p>}
            {children}
          </div>
          {footer && <div className="sheet-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export const Spinner = ({ small }: { small?: boolean }) => (
  <span className={`spinner ${small ? "small" : ""}`} role="status" aria-label="Loading" />
);

/** Copies text; falls back to a hidden textarea when the Clipboard API isn't allowed. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}
