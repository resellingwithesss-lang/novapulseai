"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { isAdminOrAboveRole } from "@/lib/roles"

export default function AdminHotkeyPanel() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const router = useRouter()
  const { user } = useAuth()

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // SAFE COMBO: CTRL + SHIFT + A
      if (e.ctrlKey && e.shiftKey && e.code === "KeyA") {
        e.preventDefault()
        setOpen(true)
      }

      if (e.key === "Escape") {
        setOpen(false)
      }
    }

    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (!panelRef.current) return
      if (!panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    const t = window.setTimeout(() => {
      document.addEventListener("click", handleClickOutside)
    }, 0)

    return () => {
      window.clearTimeout(t)
      document.removeEventListener("click", handleClickOutside)
    }
  }, [open])

  const enterAdmin = () => {
    if (!user) {
      alert("You must be logged in.")
      return
    }

    if (!isAdminOrAboveRole(user.role)) {
      alert("Admin access required.")
      return
    }

    setOpen(false)
    router.push("/admin")
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-2xl">
      <div
        ref={panelRef}
        className="w-[420px] max-w-[92%] rounded-3xl border border-purple-500/30 bg-[#0b0f19]/95 backdrop-blur-xl p-8 shadow-[0_0_80px_rgba(139,92,246,0.35)]"
      >
        <div className="text-center mb-8">
          <div className="text-xs uppercase tracking-widest text-purple-400 mb-2">
            NovaPulseAI Internal
          </div>

          <h2 className="text-xl font-semibold text-white">
            Executive Access Portal
          </h2>
        </div>

        <button
          onClick={enterAdmin}
          className="w-full py-3 rounded-full font-semibold text-white bg-gradient-to-r from-purple-500 to-pink-600 hover:scale-[1.02] transition-all shadow-lg shadow-purple-500/30"
        >
          Enter Admin
        </button>

        <button
          onClick={() => setOpen(false)}
          className="w-full mt-5 text-xs text-white/40 hover:text-white transition"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}