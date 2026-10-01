"use client"

import { Linkedin } from "lucide-react"
import { motion } from "framer-motion"

const ease = [0.22, 1, 0.36, 1] as const

export function Footer() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, ease }}
      className="w-full border-t-2 border-foreground px-6 py-8 lg:px-12"
    >
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-mono tracking-[0.15em] uppercase font-bold text-foreground">
            REWALLET
          </span>
          <div className="flex items-center gap-4" aria-label="Redes sociales">
            <motion.a href="https://x.com" aria-label="ReWALLET en X" initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1, duration: 0.4, ease }} className="text-lg font-mono text-muted-foreground hover:text-foreground transition-colors duration-200">
              <span aria-hidden="true">𝕏</span>
            </motion.a>
            <motion.a href="https://linkedin.com" aria-label="ReWALLET en LinkedIn" initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.16, duration: 0.4, ease }} className="text-muted-foreground hover:text-foreground transition-colors duration-200">
              <Linkedin size={17} strokeWidth={2} aria-hidden="true" />
            </motion.a>
          </div>
        </div>
        <div className="flex w-full items-center justify-center gap-8 md:w-auto">
          <div className="flex items-center gap-4" aria-label="Enlaces legales y estado">
            {["Privacy", "Terms", "Status"].map((link, i) => (
              <motion.a key={link} href="#" initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.22 + i * 0.06, duration: 0.4, ease }} className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors duration-200">{link}</motion.a>
            ))}
          </div>
        </div>
      </div>
    </motion.footer>
  )
}
