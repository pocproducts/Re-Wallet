"use client"

import { createContext, useContext, useMemo, useState } from "react"

type Language = "es" | "en" | "pt"

type Copy = {
  nav: { proposal: string; how: string; features: string; roadmap: string; cta: string }
  hero: { titleOne: string; titleTwo: string; description: string; cta: string }
  problem: { title: string; intro: string; banks: string; banksText: string; wallets: string; walletsText: string; fintech: string; fintechText: string }
  solution: { eyebrow: string; title: string; intro: string; face: string; faceText: string; yield: string; yieldText: string; sends: string; sendsText: string }
  sections: { how: string; features: string; featuresTitle: string; featuresDescription: string; roadmap: string; roadmapTitle: string; roadmapDescription: string; architecture: string; privateBeta: string; betaTitle: string; betaDescription: string; betaButton: string; betaNote: string }
  workflow: { left: string[]; right: string[] }
  manifest: { title: string; subtitle: string; first: string; second: string; paymaster: string; gas: string }
  roadmapItems: string[][]
}

const copy: Record<Language, Copy> = {
  es: {
    nav: { proposal: "Propuesta", how: "Cómo funciona", features: "Funcionalidades", roadmap: "Hoja de ruta", cta: "Probar ahora" },
    hero: { titleOne: "DÓLARES. RINDIENDO.", titleTwo: "AL MOMENTO.", description: "Una cuenta en dólares digitales para ahorrar, enviar y hacer rendir tu dinero sin aprender cripto.", cta: "Probar ahora Versión Alpha" },
    problem: { title: "El problema", intro: "Ahorrar en dólares todavía es un dolor de cabeza. ReWALLET elimina las tres fricciones al mismo tiempo.", banks: "BANCOS TRADICIONALES", banksText: "Tu dinero pierde valor con la inflación. Las tasas de ahorro no alcanzan.", wallets: "WALLETS CRIPTO", walletsText: "12 palabras que no podés perder. Elegir entre 20 redes.", fintech: "APPS DE FINTECH", fintechText: "Múltiples pantallas para hacer algo simple." },
    solution: { eyebrow: "NUESTRA SOLUCION", title: "Una cuenta. Un saldo. Cero complejidad.", intro: "ReWALLET es la primera cuenta en dólares digitales diseñada para el usuario que nunca tocó cripto.", face: "Face ID como login", faceText: "Tu cara es tu contraseña.", yield: "Rendimiento automático", yieldText: "Cada dólar depositado genera rendimiento automáticamente.", sends: "Envíos por tag", sendsText: "Mandá dinero sin direcciones hexadecimales." },
    sections: { how: "// SECCION: COMO FUNCIONA", features: "// SECCION: FUNCIONALIDADES", featuresTitle: "CONOCE COMO OPERAMOS", featuresDescription: "Todo lo que necesitás para usar dólares digitales sin aprender cripto.", roadmap: "// SECCION: HOJA DE RUTA", roadmapTitle: "Hoy Monad. Mañana el ecosistema completo.", roadmapDescription: "Cinco etapas. Cada una agrega capacidades sin reescribir las anteriores.", architecture: "ARQUITECTURA E INGENIERIA PLANTEADA", privateBeta: "// SECCION: INGRESO PRIVADO / SOCIOS", betaTitle: "El futuro del dinero empieza hoy.", betaDescription: "ReWALLET está en beta privada. Buscamos instituciones y partners que quieran sumarse.", betaButton: "Quiero probarlo", betaNote: "Sin compromiso. Sin spam." },
    workflow: { left: ["Enviar", "Recibir", "Ahorrar"], right: ["Rendir", "Seguro", "Global"] },
    manifest: { title: "Cómo funciona", subtitle: "sin complejidad", first: "Lo que el usuario no ve es lo que hace la diferencia. Cada operación ejecuta una coreografía de pasos on-chain que el usuario nunca ve. La complejidad existe, pero vive en el backend.", second: "Wallet embebida en TEE. Cuando te registrás, se crea una wallet custodiada en un Trusted Execution Environment. El usuario nunca ve la clave privada.", paymaster: "PAYMASTER:", gas: "GAS ABSORBIDO" },
    roadmapItems: [["01", "LABORATORIO", "Pools eficientes, wallets embebidas y gas abstraído. Verificamos la base on-chain para que cada operación sea segura y simple."], ["02", "PRUEBA DE CONCEPTO", "Interfaz inicial, onboarding con passkey y pruebas end to end para validar el recorrido completo del usuario."], ["03", "PRODUCTO MÍNIMO VIABLE", "Mejoras de UI/UX para payments, finance y trading. Blockchain por detrás, arquitectura de sistemas y modelo de negocio."], ["04", "ON-RAMP + OFF-RAMP", "Entradas y salidas a moneda local. Expansión a mercados latinoamericanos, marketing y go to market."], ["05", "ECOSISTEMA COMPLETO", "Más activos, más redes y routing universal. Una wallet universal con un solo saldo para el futuro del dinero."]] ,
  },
  en: {
    nav: { proposal: "Proposal", how: "How it works", features: "Features", roadmap: "Roadmap", cta: "Try now" },
    hero: { titleOne: "DOLLARS. WORKING.", titleTwo: "INSTANTLY.", description: "A digital dollar account to save, send, and grow your money without learning crypto.", cta: "Try now Alpha Version" },
    problem: { title: "The problem", intro: "Saving in dollars is still a headache. ReWALLET removes all three frictions at once.", banks: "TRADITIONAL BANKS", banksText: "Your money loses value to inflation.", wallets: "CRYPTO WALLETS", walletsText: "Twelve words you cannot lose.", fintech: "FINTECH APPS", fintechText: "Multiple screens to do something simple." },
    solution: { eyebrow: "OUR SOLUTION", title: "One account. One balance. Zero complexity.", intro: "ReWALLET is the first digital dollar account designed for people who have never touched crypto.", face: "Face ID login", faceText: "Your face is your password.", yield: "Automatic yield", yieldText: "Every deposited dollar earns yield automatically.", sends: "Send by tag", sendsText: "Send money without hex addresses." },
    sections: { how: "// SECTION: HOW IT WORKS", features: "// SECTION: FEATURES", featuresTitle: "SEE HOW WE OPERATE", featuresDescription: "Everything you need to use digital dollars without learning crypto.", roadmap: "// SECTION: ROADMAP", roadmapTitle: "Today Monad. Tomorrow the full ecosystem.", roadmapDescription: "Five stages. Each adds capabilities without rewriting what came before.", architecture: "PLANNED ARCHITECTURE AND ENGINEERING", privateBeta: "// SECTION: PRIVATE ENTRY / PARTNERS", betaTitle: "The future of money starts today.", betaDescription: "ReWALLET is in private beta. We are looking for institutions and partners to join.", betaButton: "I want to try it", betaNote: "No commitment. No spam." },
    workflow: { left: ["Send", "Receive", "Save"], right: ["Grow", "Secure", "Global"] },
    manifest: { title: "How it works", subtitle: "without complexity", first: "What users do not see is what makes the difference. Every operation runs an on-chain choreography that users never see. The complexity exists, but it lives in the backend.", second: "TEE-embedded wallet. When you sign up, a custodial wallet is created in a Trusted Execution Environment. Users never see the private key.", paymaster: "PAYMASTER:", gas: "GAS ABSORBED" },
    roadmapItems: [["01", "LAB", "Efficient pools, embedded wallets, and abstracted gas. We verify the on-chain foundation so every operation is safe and simple."], ["02", "PROOF OF CONCEPT", "Initial interface, passkey onboarding, and end-to-end tests to validate the complete user journey."], ["03", "MINIMUM VIABLE PRODUCT", "UI/UX improvements for payments, finance, and trading. Blockchain underneath, systems architecture, and business model."], ["04", "ON-RAMP + OFF-RAMP", "Local currency in and out. Expansion across Latin American markets, marketing, and go-to-market."], ["05", "FULL ECOSYSTEM", "More assets, more networks, and universal routing. One universal wallet with one balance for the future of money."]] ,
  },
  pt: {
    nav: { proposal: "Proposta", how: "Como funciona", features: "Funcionalidades", roadmap: "Roteiro", cta: "Experimentar agora" },
    hero: { titleOne: "DÓLARES. RENDENDO.", titleTwo: "NA HORA.", description: "Uma conta em dólares digitais para guardar, enviar e fazer seu dinheiro render sem aprender cripto.", cta: "Experimentar agora Versão Alpha" },
    problem: { title: "O problema", intro: "Guardar em dólares ainda é uma dor de cabeça. A ReWALLET elimina as três fricções ao mesmo tempo.", banks: "BANCOS TRADICIONAIS", banksText: "Seu dinheiro perde valor com a inflação. As taxas de poupança não acompanham. Mover dólares para o exterior é caro e lento.", wallets: "CARTEIRAS CRIPTO", walletsText: "Doze palavras que você não pode perder. Escolher entre vinte redes. Pagar gas com tokens que você não entende.", fintech: "APPS DE FINTECH", fintechText: "Múltiplas telas para fazer algo simples. O usuário faz o trabalho do sistema." },
    solution: { eyebrow: "NÓS SOMOS A SOLUÇÃO", title: "Uma conta. Um saldo. Zero complexidade.", intro: "A ReWALLET é a primeira conta em dólares digitais projetada para quem nunca usou cripto.", face: "Face ID como login", faceText: "Seu rosto é sua senha. Sem sementes, sem passwords e sem fricção.", yield: "Rendimento automático", yieldText: "Cada dólar depositado vai automaticamente para um pool de liquidez. O juro composto é creditado todos os dias.", sends: "Envios por tag", sendsText: "Envie dinheiro para @carlos, um e-mail ou telefone. Sem endereços hexadecimais." },
    sections: { how: "// SEÇÃO: COMO FUNCIONA", features: "// SEÇÃO: FUNCIONALIDADES", featuresTitle: "CONHEÇA COMO OPERAMOS", featuresDescription: "Tudo o que você precisa para usar dólares digitais sem aprender cripto.", roadmap: "// SEÇÃO: ROTEIRO", roadmapTitle: "Hoje Monad. Amanhã, o ecossistema completo.", roadmapDescription: "Cinco etapas. Cada uma adiciona capacidades sem reescrever as anteriores.", architecture: "ARQUITETURA E ENGENHARIA PLANEJADA", privateBeta: "// SEÇÃO: ENTRADA PRIVADA / SÓCIOS", betaTitle: "O futuro do dinheiro começa hoje.", betaDescription: "A ReWALLET está em beta privada. Buscamos instituições e parceiros para participar.", betaButton: "Quero experimentar", betaNote: "Sem compromisso. Sem spam." },
    workflow: { left: ["Enviar", "Receber", "Economizar"], right: ["Render", "Seguro", "Global"] },
    manifest: { title: "Como funciona", subtitle: "sem complexidade", first: "O que o usuário não vê é o que faz a diferença. Cada operação executa uma coreografia on-chain que o usuário nunca vê. A complexidade existe, mas vive no backend.", second: "Carteira incorporada em TEE. Ao se cadastrar, uma carteira custodial é criada em um Trusted Execution Environment. O usuário nunca vê a chave privada.", paymaster: "PAYMASTER:", gas: "GAS ABSORVIDO" },
    roadmapItems: [["01", "LABORATÓRIO", "Pools eficientes, carteiras incorporadas e gas abstraído. Verificamos a base on-chain para que cada operação seja segura e simples."], ["02", "PROVA DE CONCEITO", "Interface inicial, onboarding com passkey e testes end-to-end para validar toda a jornada do usuário."], ["03", "PRODUTO MÍNIMO VIÁVEL", "Melhorias de UI/UX para pagamentos, finanças e trading. Blockchain por trás, arquitetura de sistemas e modelo de negócio."], ["04", "ON-RAMP + OFF-RAMP", "Entradas e saídas em moeda local. Expansão para mercados latino-americanos, marketing e go-to-market."], ["05", "ECOSSISTEMA COMPLETO", "Mais ativos, mais redes e roteamento universal. Uma carteira universal com um único saldo para o futuro do dinheiro."]] ,
  },
}

const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void; copy: Copy } | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("es")
  const value = useMemo(() => ({ language, setLanguage, copy: copy[language] }), [language])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider")
  return value
}

export function LanguageSelector() {
  const { language, setLanguage } = useLanguage()
  return (
    <label className="relative flex h-8 items-center border border-foreground/20 bg-background/50 px-2">
      <span className="sr-only">Select language</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
        className="cursor-pointer appearance-none bg-transparent pr-3 text-[10px] font-mono uppercase tracking-widest text-foreground outline-none"
        aria-label="Select language"
      >
        <option value="es">ES</option>
        <option value="en">EN</option>
        <option value="pt">PT</option>
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-1 text-[9px] text-muted-foreground">⌄</span>
    </label>
  )
}

export type { Language }
