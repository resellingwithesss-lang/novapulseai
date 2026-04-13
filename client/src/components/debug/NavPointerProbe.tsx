"use client"

import { useEffect } from "react"
import { npaiDebugSessionAppend } from "@/lib/npaiDebugSession"

/**
 * Dev-only: capture-phase pointerdown + click on anchors to separate
 * hit-testing (overlay?) from whether a link click event actually fires.
 */
export default function NavPointerProbe() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return

    const send = (payload: Record<string, unknown>) => {
      void fetch("/npai-internal/debug-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify(payload),
      }).catch(() => {})
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element)) return
      const t = e.target
      const a = t.closest("a[href]")
      const top = document.elementFromPoint(e.clientX, e.clientY)
      const data = {
        path: window.location.pathname,
        targetTag: t.tagName,
        targetId: t.id || null,
        targetClass: (typeof t.className === "string" ? t.className : "")
          .split(/\s+/)
          .slice(0, 8)
          .join(" "),
        topTag: top instanceof Element ? top.tagName : null,
        topId: top instanceof Element ? top.id || null : null,
        anchorHref: a?.getAttribute("href") ?? null,
        clientX: e.clientX,
        clientY: e.clientY,
      }
      npaiDebugSessionAppend("pointerdown_capture", data)
      send({
        sessionId: "a5148d",
        hypothesisId: "H_overlay",
        location: "NavPointerProbe.tsx:pointerdown",
        message: "pointerdown_capture",
        data,
        timestamp: Date.now(),
      })
    }

    const onClickCapture = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return
      const a = e.target.closest("a[href]")
      if (!a) return
      const href = a.getAttribute("href")
      const data = {
        path: window.location.pathname,
        href,
        defaultPrevented: e.defaultPrevented,
      }
      npaiDebugSessionAppend("click_capture_anchor", data)
      send({
        sessionId: "a5148d",
        hypothesisId: "H_click_path",
        location: "NavPointerProbe.tsx:click",
        message: "click_capture_anchor",
        data,
        timestamp: Date.now(),
      })
    }

    const capOpts = { capture: true, passive: true } as const
    window.addEventListener("pointerdown", onPointerDown, capOpts)
    window.addEventListener("click", onClickCapture, capOpts)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, capOpts)
      window.removeEventListener("click", onClickCapture, capOpts)
    }
  }, [])

  return null
}
