"use client"

import { WorkflowDiagram } from "@/components/workflow-diagram"
import { ArrowRight } from "lucide-react"
import { motion } from "framer-motion"
import { useLanguage } from "@/components/language-provider"

const ease = [0.22, 1, 0.36, 1] as const

export function HeroSection() {
  const { copy } = useLanguage()

  return (
    <section className="relative w-full px-6 pt-6 pb-12 sm:px-12 lg:px-24 lg:pt-10 lg:pb-16">
      <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
        <div className="flex flex-col items-start text-left">
          <motion.h1
            initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.7, ease }}
            className="font-pixel text-4xl tracking-tight text-foreground sm:text-6xl lg:text-7xl xl:text-8xl select-none"
          >
            {copy.hero.titleOne}
          </motion.h1>

          <motion.h1
            initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.7, delay: 0.25, ease }}
            className="font-pixel mt-2 mb-4 text-4xl tracking-tight text-foreground sm:text-6xl lg:text-7xl xl:text-8xl select-none"
          >
            {copy.hero.titleTwo}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45, ease }}
            className="mb-6 max-w-md text-left text-xs leading-relaxed text-muted-foreground lg:text-sm font-mono"
          >
            {copy.hero.description}
          </motion.p>

          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6, ease }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="group flex items-center gap-0 bg-foreground text-background text-sm font-mono tracking-wider uppercase"
          >
            <span className="flex h-10 w-10 items-center justify-center bg-[#ea580c]">
              <motion.span
                className="inline-flex"
                whileHover={{ x: 3 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <ArrowRight size={16} strokeWidth={2} className="text-background" />
              </motion.span>
            </span>
            <span className="px-5 py-2.5">{copy.hero.cta}</span>
          </motion.button>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.15, ease }}
          className="relative z-30 w-full lg:scale-[1.28] lg:origin-center"
        >
          <WorkflowDiagram />
        </motion.div>
      </div>
    </section>
  )
}
