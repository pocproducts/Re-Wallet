"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Check, Minus } from "lucide-react"
import { motion } from "framer-motion"
import { useLanguage } from "@/components/language-provider"

const ease = [0.22, 1, 0.36, 1] as const

/* ── scramble-in price effect ── */
function ScramblePrice({ target, prefix = "#" }: { target: string; prefix?: string }) {
  const [display, setDisplay] = useState(target.replace(/[0-9]/g, "0"))

  useEffect(() => {
    let iterations = 0
    const maxIterations = 18
    const interval = setInterval(() => {
      if (iterations >= maxIterations) {
        setDisplay(target)
        clearInterval(interval)
        return
      }
      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (!/[0-9]/.test(char)) return char
            if (iterations > maxIterations - 5 && i < iterations - (maxIterations - 5)) return char
            return String(Math.floor(Math.random() * 10))
          })
          .join("")
      )
      iterations++
    }, 50)
    return () => clearInterval(interval)
  }, [target])

  return (
    <span className="font-mono font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}{display}
    </span>
  )
}

/* ── data-stream status line ── */
function StatusLine() {
  const [throughput, setThroughput] = useState("0.0")

  useEffect(() => {
    const interval = setInterval(() => {
      setThroughput((Math.random() * 50 + 10).toFixed(1))
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-2 text-[10px] tracking-widest text-muted-foreground uppercase font-mono">
      <span className="h-1.5 w-1.5 bg-[#ea580c]" />
      <span>live throughput: {throughput}k req/s</span>
    </div>
  )
}

/* ── blinking cursor indicator ── */
function BlinkDot() {
  return <span className="inline-block h-2 w-2 bg-[#ea580c] animate-blink" />
}

/* ── tier config ── */
interface Tier {
  id: string
  name: string
  price: string
  period: string
  tag: string | null
  description: string
  features: { text: string; included: boolean }[]
  cta: string
  highlighted: boolean
}

const TIERS: Tier[] = [
  { id: "face-id", name: "LOGIN CON FACE ID", price: "01", period: "", tag: "CORE", description: "Tu cara es tu contraseña. Sin semillas, sin passwords.", features: [{ text: "Wallet creada automáticamente", included: true }, { text: "Registro en 10 segundos", included: true }], cta: "CONOCER MÁS", highlighted: true },
  { id: "deposito", name: "DEPÓSITO", price: "02", period: "", tag: null, description: "Transferencia u otra wallet. El backend se encarga de todo.", features: [{ text: "Desde cualquier lugar", included: true }, { text: "Una cuenta en dólares", included: true }], cta: "CONOCER MÁS", highlighted: false },
  { id: "yield", name: "RENDIMIENTO", price: "03", period: "", tag: "CORE", description: "~4-5% anual generado desde el primer segundo. Sin staking.", features: [{ text: "Interés compuesto diario", included: true }, { text: "Sin acción manual", included: true }], cta: "CONOCER MÁS", highlighted: true },
  { id: "tags", name: "ENVÍOS POR TAG", price: "04", period: "", tag: null, description: "Mandá dinero a @carlos, un email o un teléfono.", features: [{ text: "Sin direcciones hex", included: true }, { text: "Sin elegir redes", included: true }], cta: "CONOCER MÁS", highlighted: false },
  { id: "links", name: "LINKS DE COBRO", price: "05", period: "", tag: "CORE", description: "Generá un link y compartilo. Sin app del receptor.", features: [{ text: "Cobrá como mandás un mensaje", included: true }, { text: "Fácil para todos", included: true }], cta: "CONOCER MÁS", highlighted: true },
  { id: "activity", name: "ACTIVIDAD", price: "06", period: "", tag: null, description: "Todos tus movimientos en un solo lugar, agrupados por fecha.", features: [{ text: "Historial unificado", included: true }, { text: "Transparencia total", included: true }], cta: "CONOCER MÁS", highlighted: false },
  { id: "withdraw", name: "RETIRO", price: "07", period: "", tag: null, description: "Retirá cuando quieras. Sin locks, mínimos ni penalidades.", features: [{ text: "Liquidez inmediata", included: true }, { text: "Controlás tu dinero", included: true }], cta: "CONOCER MÁS", highlighted: false },
  { id: "multi-asset", name: "MULTI-ASSET", price: "08", period: "", tag: "NEXT", description: "Dólares, Bitcoin, Ethereum. Todo en un solo saldo.", features: [{ text: "Múltiples activos", included: true }, { text: "Una sola experiencia", included: true }], cta: "CONOCER MÁS", highlighted: false },
  { id: "off-ramp", name: "OFF-RAMP", price: "09", period: "", tag: "NEXT", description: "On-ramp y off-ramp: convertí dinero local a dólares digitales y retiralos cuando quieras.", features: [{ text: "Salida simple a moneda local", included: true }, { text: "Expansión a mercados LATAM", included: true }], cta: "CONOCER MÁS", highlighted: false },
]

/* ── single pricing card ── */
function PricingCard({ tier, index }: { tier: Tier; index: number }) {
  const isCustom = tier.price === "CUSTOM"

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: index * 0.12, duration: 0.6, ease }}
      className={`flex flex-col h-full ${
        tier.highlighted
          ? "border-2 border-foreground bg-foreground text-background"
          : "border-2 border-foreground bg-background text-foreground"
      }`}
    >
      {/* Card header */}
      <div
        className={`flex items-center justify-between px-5 py-3 border-b-2 ${
          tier.highlighted ? "border-background/20" : "border-foreground"
        }`}
      >
        <span className="text-[10px] tracking-[0.2em] uppercase font-mono">
          {tier.name}
        </span>
        <div className="flex items-center gap-2">
          {tier.tag && (
            <span className="bg-[#ea580c] text-background text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 font-mono">
              {tier.tag}
            </span>
          )}
          <span className="text-[10px] tracking-[0.2em] font-mono opacity-50">
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Price block */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-baseline gap-1">
          {isCustom ? (
            <span className="text-3xl lg:text-4xl font-mono font-bold tracking-tight">CUSTOM</span>
          ) : (
            <span className="text-3xl lg:text-4xl">
              <ScramblePrice target={tier.price} />
            </span>
          )}
          {tier.period && (
            <span
              className={`text-xs font-mono tracking-widest uppercase ${
                tier.highlighted ? "text-background/50" : "text-muted-foreground"
              }`}
            >
              {tier.period}
            </span>
          )}
        </div>
        <p
          className={`text-xs font-mono mt-3 leading-relaxed ${
            tier.highlighted ? "text-background/60" : "text-muted-foreground"
          }`}
        >
          {tier.description}
        </p>
      </div>

      {/* Feature list */}
      <div
        className={`flex-1 px-5 py-4 border-t-2 ${
          tier.highlighted ? "border-background/20" : "border-foreground"
        }`}
      >
        <div className="flex flex-col gap-3">
          {tier.features.map((feature, fi) => (
            <motion.div
              key={feature.text}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.12 + 0.3 + fi * 0.04, duration: 0.35, ease }}
              className="flex items-start gap-3"
            >
              {feature.included ? (
                <Check
                  size={12}
                  strokeWidth={2.5}
                  className="mt-0.5 shrink-0 text-[#ea580c]"
                />
              ) : (
                <Minus
                  size={12}
                  strokeWidth={2}
                  className={`mt-0.5 shrink-0 ${
                    tier.highlighted ? "text-background/30" : "text-muted-foreground/40"
                  }`}
                />
              )}
              <span
                className={`text-xs font-mono leading-relaxed ${
                  feature.included
                    ? ""
                    : tier.highlighted
                    ? "text-background/30 line-through"
                    : "text-muted-foreground/40 line-through"
                }`}
              >
                {feature.text}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="px-5 pb-5 pt-3">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className={`group w-full flex items-center justify-center gap-0 text-xs font-mono tracking-wider uppercase ${
            tier.highlighted
              ? "bg-background text-foreground"
              : "bg-foreground text-background"
          }`}
        >
          <span className="flex items-center justify-center w-9 h-9 bg-[#ea580c]">
            <ArrowRight size={14} strokeWidth={2} className="text-background" />
          </span>
          <span className="flex-1 py-2.5">{tier.cta}</span>
        </motion.button>
      </div>
    </motion.div>
  )
}

/* ── main pricing section ── */
export function PricingSection() {
  const { copy } = useLanguage()
  return (
    <section id="pricing-tiers" className="w-full px-6 py-20 lg:px-12">
      {/* Section label */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease }}
        className="flex items-center gap-4 mb-8"
      >
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">
          {copy.sections.features}
        </span>
        <div className="flex-1 border-t border-border" />
        <BlinkDot />
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">
          006
        </span>
      </motion.div>

      {/* Section header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.6, ease }}
        className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-12"
      >
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl lg:text-3xl font-mono font-bold tracking-tight uppercase text-foreground text-balance">
            {copy.sections.featuresTitle}
          </h2>
          <p className="text-xs lg:text-sm font-mono text-muted-foreground leading-relaxed max-w-md">
            {copy.sections.featuresDescription}
          </p>
        </div>
        <StatusLine />
      </motion.div>

      {/* Pricing grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
        {TIERS.map((tier, i) => (
          <PricingCard key={tier.id} tier={tier} index={i} />
        ))}
      </div>

      {/* Bottom note */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.5, duration: 0.5, ease }}
        className="flex items-center gap-3 mt-6"
      >
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">
          {"* Una experiencia. Más capacidades. Cero complejidad."}
        </span>
        <div className="flex-1 border-t border-border" />
      </motion.div>

      {/* Roadmap */}
      <div id="roadmap" className="mt-20">
        <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, ease }} className="mb-8 flex items-center gap-4">
          <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">{copy.sections.roadmap}</span>
          <div className="flex-1 border-t border-border" />
          <span className="text-[10px] tracking-[0.2em] font-mono text-[#ea580c]">005</span>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, ease }} className="grid overflow-hidden border-2 border-foreground lg:grid-cols-2">
          <div className="p-5 lg:p-8">
            <h3 className="text-2xl lg:text-3xl font-mono font-bold uppercase tracking-tight">{copy.sections.roadmapTitle}</h3>
            <p className="mt-3 max-w-2xl text-xs lg:text-sm font-mono leading-relaxed text-muted-foreground">{copy.sections.roadmapDescription}</p>
            <div className="mt-8 grid gap-0">{copy.roadmapItems.map(([number, title, description]) => <div key={number} className="grid grid-cols-[42px_1fr] gap-4 border-t-2 border-foreground py-4 last:border-b-2"><span className="font-mono text-sm font-bold text-[#ea580c]">{number}</span><div><h4 className="font-mono text-xs font-bold tracking-[0.12em]">{title}</h4><p className="mt-2 text-xs font-mono leading-relaxed text-muted-foreground">{description}</p></div></div>)}</div>
          </div>
          <div className="relative min-h-[360px] border-t-2 border-foreground bg-foreground lg:min-h-full lg:border-l-2 lg:border-t-0">
            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-foreground/85 px-4 py-2 backdrop-blur-sm">
              <span className="text-[10px] tracking-[0.2em] uppercase text-background/60 font-mono">{copy.sections.architecture}</span>
              <span className="text-[10px] tracking-[0.2em] uppercase text-[#ea580c] font-mono">LIVE</span>
            </div>
            <img src="/images/roadmap-architecture.png" alt="Arquitectura vertical de ReWALLET con cinco etapas conectadas, desde la custodia hasta el ecosistema digital" className="h-full min-h-[360px] w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between bg-foreground/85 px-4 py-2 backdrop-blur-sm"><span className="text-[10px] tracking-[0.2em] uppercase text-background/40 font-mono">FLOW: ON-CHAIN / ABSTRACTED</span><span className="text-[10px] tracking-[0.2em] uppercase text-background/40 font-mono">RES: 2048x2048</span></div>
          </div>
        </motion.div>
      </div>

      {/* Private beta / partners */}
      <div className="mt-20 w-full">
        <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, ease }} className="mb-8 flex items-center gap-4"><span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono">{copy.sections.privateBeta}</span><div className="flex-1 border-t border-border" /><span className="text-[10px] tracking-[0.2em] font-mono text-[#ea580c]">006</span></motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, ease }} className="grid gap-8 bg-foreground text-background p-5 lg:grid-cols-2 lg:items-center lg:p-8">
          <div><h3 className="text-2xl lg:text-3xl font-mono font-bold uppercase tracking-tight">{copy.sections.betaTitle}</h3><p className="mt-4 max-w-xl text-xs font-mono leading-relaxed text-background/60">{copy.sections.betaDescription}</p></div>
          <form onSubmit={(event) => event.preventDefault()}><label htmlFor="waitlist-email" className="sr-only">Tu email</label><div className="flex border-2 border-background"><input id="waitlist-email" type="email" required placeholder="tu@correo.com" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-xs font-mono text-background outline-none placeholder:text-background/40" /><button type="submit" className="bg-[#ea580c] px-4 text-[10px] font-mono font-bold uppercase tracking-wider text-background">{copy.sections.betaButton}</button></div><p className="mt-3 text-[10px] font-mono text-background/40">{copy.sections.betaNote}</p></form>
        </motion.div>
      </div>
    </section>
  )
}
