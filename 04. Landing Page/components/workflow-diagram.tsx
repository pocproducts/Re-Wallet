"use client"

import { motion } from "framer-motion"
import { useEffect, useState } from "react"
import { useLanguage } from "@/components/language-provider"

/* Counts only: the words come from language-provider, so every label changes
   in every language. */
const LEFT_LABELS = ["Send", "Receive", "Save"]
const RIGHT_LABELS = ["Grow", "Secure", "Global"]

function PillLabel({
  label,
  x,
  y,
  delay,
}: {
  label: string
  x: number
  y: number
  delay: number
}) {
  return (
    <motion.g
      initial={{ opacity: 0, x: x > 400 ? 20 : -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      <circle cx={x} cy={y + 18} r={4} fill="#ea580c" />
      <rect
        x={x}
        y={y}
        width={140}
        height={36}
        rx={18}
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeWidth={1.5}
      />
      <text
        x={x + 70}
        y={y + 23}
        textAnchor="middle"
        fill="hsl(var(--foreground))"
        fontSize={12}
        fontFamily="var(--font-mono), monospace"
        fontWeight={500}
        letterSpacing="0.05em"
      >
        {label}
      </text>
    </motion.g>
  )
}

export function WorkflowDiagram() {
  const { copy } = useLanguage()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="h-[280px] w-full" />
  }

  const centerX = 480
  const centerY = 140
  const pillWidth = 140
  const leftPillX = 40
  const rightPillX = 800
  const rowGap = 80

  return (
    <div className="relative z-40 mx-auto min-h-[210px] w-full max-w-[960px] overflow-visible rounded-sm bg-[radial-gradient(circle,_hsl(var(--border))_0.7px,_transparent_0.7px)] bg-[length:22px_22px] p-2">
      <svg
        viewBox="0 0 960 280"
        className="h-auto w-full"
        role="img"
        aria-label="Workflow diagram: a central digital wallet connected to sending, receiving and saving capabilities"
      >
        {/* Left lines from center to left labels */}
        {LEFT_LABELS.map((_, i) => {
          const pillX = leftPillX
          const pillY = 40 + i * rowGap
          return (
            <motion.path
              key={`left-line-${i}`}
              d={`M ${centerX - 40} ${centerY} L ${centerX - 90} ${centerY} L ${centerX - 145} ${pillY + 18} L ${pillX + pillWidth} ${pillY + 18}`}
              fill="none"
              stroke="#ea580c"
              strokeWidth={1}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.1 }}
            />
          )
        })}

        {/* Right lines from center to right labels */}
        {RIGHT_LABELS.map((_, i) => {
          const pillX = rightPillX
          const pillY = 40 + i * rowGap
          return (
            <motion.path
              key={`right-line-${i}`}
              d={`M ${centerX + 40} ${centerY} L ${centerX + 90} ${centerY} L ${centerX + 145} ${pillY + 18} L ${pillX} ${pillY + 18}`}
              fill="none"
              stroke="#ea580c"
              strokeWidth={1}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.1 }}
            />
          )
        })}

        {/* Data packets flowing along lines */}
        {LEFT_LABELS.map((_, i) => {
          const pillX = leftPillX
          const pillY = 40 + i * rowGap
          return (
            <motion.circle
              key={`left-packet-${i}`}
              r={3}
              fill="#ea580c"
              initial={{ cx: pillX + pillWidth, cy: pillY + 18 }}
              animate={{
                cx: [pillX + pillWidth, centerX - 40],
                cy: [pillY + 18, centerY],
              }}
              transition={{
                duration: 1.8,
                delay: 0.8 + i * 0.6,
                repeat: Infinity,
                repeatDelay: 3,
                ease: "linear",
              }}
            />
          )
        })}

        {RIGHT_LABELS.map((_, i) => {
          const pillX = rightPillX
          const pillY = 40 + i * rowGap
          return (
            <motion.circle
              key={`right-packet-${i}`}
              r={3}
              fill="#ea580c"
              initial={{ cx: centerX + 40, cy: centerY }}
              animate={{
                cx: [centerX + 40, pillX],
                cy: [centerY, pillY + 18],
              }}
              transition={{
                duration: 1.8,
                delay: 1.2 + i * 0.6,
                repeat: Infinity,
                repeatDelay: 3,
                ease: "linear",
              }}
            />
          )
        })}

        {/* Left pill labels */}
        {copy.workflow.left.map((label, i) => (
          <PillLabel
            key={`left-${label}`}
            label={label}
            x={leftPillX}
            y={40 + i * rowGap}
            delay={0.1 + i * 0.1}
          />
        ))}

        {/* Right pill labels */}
        {copy.workflow.right.map((label, i) => (
          <PillLabel
            key={`right-${label}`}
            label={label}
            x={rightPillX}
            y={40 + i * rowGap}
            delay={0.1 + i * 0.1}
          />
        ))}

        {/* Center logo square */}
        <motion.g
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <rect
            x={centerX - 36}
            y={centerY - 36}
            width={72}
            height={72}
            fill="hsl(var(--muted))"
            stroke="hsl(var(--border))"
            strokeWidth={1.5}
          />
          <rect x={centerX - 17} y={centerY - 20} width={34} height={40} rx={4} fill="none" stroke="hsl(var(--foreground))" strokeWidth={2} />
          <rect x={centerX - 8} y={centerY - 10} width={16} height={13} rx={2} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
          <circle cx={centerX + 8} cy={centerY + 9} r={4} fill="#ea580c" />
          {/* Pulsing ring */}
          <circle cx={centerX} cy={centerY} r={30} fill="none" stroke="#ea580c" strokeWidth={1}>
            <animate
              attributeName="r"
              values="30;34;30"
              dur="3s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.6;0.2;0.6"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
        </motion.g>
      </svg>
    </div>
  )
}
