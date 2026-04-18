"use client"

import { forwardRef, type SelectHTMLAttributes } from "react"

/** Matches `.np-select` in `globals.css` — use for consistent dark dropdowns. */
export const NP_SELECT_CLASS = "np-select"

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Dense admin filters / tables */
  size?: "default" | "sm" | "xs"
}

/**
 * Native `<select>` with global dark-theme styling (see `globals.css` `.np-select`).
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = "", size = "default", ...props },
  ref
) {
  const sizeCls =
    size === "sm" ? "np-select--sm" : size === "xs" ? "np-select--xs" : ""
  const merged = [NP_SELECT_CLASS, sizeCls, className].filter(Boolean).join(" ")
  return <select ref={ref} className={merged} {...props} />
})
