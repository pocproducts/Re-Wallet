"use client"

import Image from "next/image"
import { motion } from "framer-motion"
import { useLanguage } from "@/components/language-provider"

const ease = [0.22, 1, 0.36, 1] as const

/* The one real capture. Nothing else in this section is drawn: every other
   screen is an explicitly empty slot, because a drawn "app screen" would be a
   false claim with a nicer surface.

   To replace a pending slot with the real thing: drop the capture in
   public/product/ and change that row from a caption to an <Image>, the same
   way this one is rendered. Filenames and screen list: public/product/README.md */
const REAL_CAPTURE = "/product/01-entrar.png"

export function ShowcaseSection() {
  const { copy } = useLanguage()
  const { showcase } = copy

  return (
    <section id="capturas" className="w-full px-6 py-20 lg:px-12">
      {/* Section label */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease }}
        className="flex items-center gap-4 mb-8"
      >
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">
          {showcase.label}
        </span>
        <div className="flex-1 border-t border-border" />
        <span className="text-[10px] tracking-[0.2em] uppercase font-mono text-[#ea580c]">
          {showcase.badge}
        </span>
      </motion.div>

      {/* Section header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.6, ease }}
        className="flex flex-col gap-3 mb-12"
      >
        <h2 className="text-2xl lg:text-3xl font-mono font-bold tracking-tight uppercase text-foreground text-balance">
          {showcase.title}
        </h2>
        <p className="text-xs lg:text-sm font-mono text-muted-foreground leading-relaxed max-w-2xl">
          {showcase.description}
        </p>
      </motion.div>

      {/* Real capture + pending slots */}
      <div className="grid border-2 border-foreground lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        {/* Real capture */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.6, ease }}
          className="flex flex-col items-center gap-4 bg-muted p-6 border-b-2 lg:border-b-0 lg:border-r-2 border-foreground"
        >
          <Image
            src={REAL_CAPTURE}
            alt={showcase.realAlt}
            width={390}
            height={844}
            className="h-[440px] lg:h-[560px] w-auto max-w-full object-contain border-2 border-foreground"
          />
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground text-center max-w-sm leading-relaxed">
            {showcase.realCaption}
          </p>
        </motion.div>

        {/* Empty slots: named, and plainly marked as pending */}
        <div className="divide-y-2 divide-foreground">
          {showcase.screens.map((screen, i) => (
            <motion.div
              key={screen.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.06, duration: 0.5, ease }}
              className="flex min-h-[140px] flex-col justify-center gap-2 p-5 lg:p-6"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[10px] tracking-[0.2em] uppercase font-mono font-bold text-foreground">
                  {screen.name}
                </span>
                <span className="bg-foreground/10 px-2 py-0.5 text-[9px] tracking-[0.15em] uppercase font-mono text-muted-foreground">
                  {showcase.pendingTag}
                </span>
              </div>
              <p className="text-xs font-mono text-foreground/70 leading-relaxed">
                {screen.description}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                {screen.pending}
              </p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Bottom note */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.4, duration: 0.5, ease }}
        className="flex items-center gap-3 mt-6"
      >
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">
          {showcase.note}
        </span>
        <div className="flex-1 border-t border-border" />
      </motion.div>
    </section>
  )
}