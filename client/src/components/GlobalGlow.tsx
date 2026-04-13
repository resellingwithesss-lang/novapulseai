"use client"

import { useEffect } from "react"

export default function GlobalGlow() {
  useEffect(() => {
    let frame: number

    const handleMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame)

      frame = requestAnimationFrame(() => {
        document.documentElement.style.setProperty(
          "--cursor-x",
          `${e.clientX}px`
        )
        document.documentElement.style.setProperty(
          "--cursor-y",
          `${e.clientY}px`
        )
      })
    }

    window.addEventListener("mousemove", handleMove)

    return () => {
      window.removeEventListener("mousemove", handleMove)
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-[200px] opacity-30 bg-purple-600 transition-all duration-200"
        style={{
          left: "calc(var(--cursor-x, 50%) - 300px)",
          top: "calc(var(--cursor-y, 50%) - 300px)",
        }}
      />
    </div>
  )
}