"use client"

import { createContext, useContext, useMemo, useState } from "react"

type Language = "es" | "en" | "pt"

type Copy = {
  nav: { proposal: string; how: string; features: string; roadmap: string; cta: string }
  hero: { plain: string; titleOne: string; titleTwo: string; description: string; cta: string }
  problem: { title: string; intro: string; banks: string; banksText: string; wallets: string; walletsText: string; fintech: string; fintechText: string }
  solution: { eyebrow: string; title: string; intro: string; face: string; faceText: string; yield: string; yieldText: string; sends: string; sendsText: string }
  tiers: { id: string; name: string; description: string; features: string[] }[]
  sections: { how: string; features: string; featuresTitle: string; featuresDescription: string; featuresNote: string; tierCta: string; roadmap: string; roadmapTitle: string; roadmapDescription: string; architecture: string; privateBeta: string; betaTitle: string; betaDescription: string; betaButton: string; betaNote: string }
  workflow: { left: string[]; right: string[] }
  stats: { label: string; value: string }[]
  manifest: { title: string; subtitle: string; first: string; second: string; paymaster: string; gas: string }
  roadmapItems: string[][]
}

const copy: Record<Language, Copy> = {
  es: {
    nav: { proposal: "Propuesta", how: "Cómo funciona", features: "Funcionalidades", roadmap: "Hoja de ruta", cta: "Probar ahora" },
    hero: { plain: "Una billetera digital donde guardás tus dólares, se los enviás a quien quieras y te pagan con un link, todo desde el celular.", titleOne: "GUARDÁ. ENVIÁ. COBRÁ.", titleTwo: "DESDE EL CELULAR.", description: "Un solo saldo. Mandás con el @nombre de la persona o escaneás un QR; compartís un link y te pagan desde su propia cuenta. Ethereum, Monad y Solana, y la app elige la red por vos.", cta: "Probar ahora Versión Alpha" },
    problem: { title: "El problema", intro: "Ahorrar en dólares todavía es un dolor de cabeza. ReWALLET elimina las tres fricciones al mismo tiempo.", banks: "BANCOS TRADICIONALES", banksText: "Tu dinero pierde valor con la inflación. Las tasas de ahorro no alcanzan.", wallets: "WALLETS CRIPTO", walletsText: "Una lista de palabras que no podés perder. Vos elegís la red. Pagás comisiones en un token que no entendés.", fintech: "APPS DE FINTECH", fintechText: "Múltiples pantallas para hacer algo simple." },
    solution: { eyebrow: "NUESTRA SOLUCION", title: "Una billetera. Un saldo. Cero pasos raros.", intro: "ReWALLET es una billetera digital para pagar y cobrar sin aprender cripto.", face: "Registro con passkey", faceText: "Verificás tu email y entrás con la huella o el rostro de tu celular. Sin semillas y sin contraseñas.", yield: "Rendimiento en pruebas", yieldText: "El depósito que genera rendimiento todavía no se corrió con plata real. No publicamos ninguna cifra.", sends: "Envíos por identificador", sendsText: "Mandás a @nombre, el identificador de ReWALLET. Sin direcciones hexadecimales." },
    tiers: [
      { id: "passkey", name: "REGISTRO CON PASSKEY", description: "Verificás tu email y entrás con la huella o el rostro de tu celular. Sin semillas y sin contraseñas.", features: ["Wallet creada al registrarte", "Verificás tu email"] },
      { id: "receive", name: "RECIBIR", description: "Mostrás tu dirección y su código QR. Quien te paga escanea y te cae el dinero.", features: ["Una dirección para recibir", "El QR viene incluido"] },
      { id: "yield", name: "RENDIMIENTO", description: "Guardar tu dinero y que genere rendimiento está en pruebas, dentro de la etapa de finanzas. No publicamos cifras hasta correrlo con plata real.", features: ["Todavía en pruebas", "Sin cifra publicada"] },
      { id: "handle", name: "ENVIAR POR IDENTIFICADOR", description: "Mandás a @nombre, el identificador de ReWALLET. Sin direcciones largas y sin elegir red.", features: ["Solo el @nombre del otro", "Ethereum, Monad y Solana"] },
      { id: "links", name: "LINKS DE COBRO", description: "Generás un link y lo compartís como un mensaje. La otra persona paga desde su propia cuenta.", features: ["Se comparte como un mensaje", "El otro paga desde su cuenta"] },
      { id: "activity", name: "ACTIVIDAD", description: "Todos tus movimientos en un solo lugar, agrupados por fecha.", features: ["Historial unificado", "Entradas y salidas juntas"] },
      { id: "withdraw", name: "RETIRO A MONEDA LOCAL", description: "Sacar tus dólares a dinero local todavía no existe. Es la etapa 04 del camino: On-ramp + Off-ramp.", features: ["No está disponible todavía", "Etapa 04 del roadmap"] },
      { id: "multinet", name: "UN SALDO, VARIAS REDES", description: "Ethereum, Monad y Solana en un solo saldo. La app decide por cuál red va cada envío.", features: ["Ethereum, Monad y Solana", "No elegís la red"] },
      { id: "onramp", name: "CARGAR DESDE TU BANCO", description: "Entrar con dinero de banco local es la etapa 04 del roadmap, todavía sin construir.", features: ["Etapa 04 del roadmap", "Ingreso y salida a moneda local"] },
    ],
    sections: { how: "// SECCION: COMO FUNCIONA", features: "// SECCION: FUNCIONALIDADES", featuresTitle: "QUÉ HACE REWALLET", featuresDescription: "Lo que ya funciona hoy y lo que viene después. Cada tarjeta dice en qué etapa estamos.", featuresNote: "* Un solo saldo. Varias redes. Cero pasos raros.", tierCta: "CONOCER MÁS", roadmap: "// SECCION: HOJA DE RUTA", roadmapTitle: "Hoy Monad. Mañana el ecosistema completo.", roadmapDescription: "Cinco etapas. Cada una agrega capacidades sin reescribir las anteriores.", architecture: "ARQUITECTURA E INGENIERIA PLANTEADA", privateBeta: "// SECCION: INGRESO PRIVADO / SOCIOS", betaTitle: "El futuro del dinero empieza hoy.", betaDescription: "ReWALLET está en beta privada. Buscamos instituciones y partners que quieran sumarse.", betaButton: "Quiero probarlo", betaNote: "Sin compromiso. Sin spam." },
    workflow: { left: ["Enviar", "Recibir", "Ahorrar"], right: ["Rendir", "Seguro", "Global"] },
    stats: [
      { label: "01 / IDENTIFICADOR", value: "@NOMBRE" },
      { label: "02 / REDES", value: "3" },
      { label: "03 / INGRESO", value: "PASSKEY" },
      { label: "04 / SALDO", value: "ÚNICO" },
    ],
    manifest: { title: "Cómo funciona", subtitle: "sin complejidad", first: "Lo que el usuario no ve es lo que hace la diferencia. Cada operación ejecuta una coreografía de pasos on-chain que el usuario nunca ve. La complejidad existe, pero vive en el backend.", second: "Wallet embebida en TEE. Cuando te registrás, se crea una wallet custodiada en un Trusted Execution Environment. El usuario nunca ve la clave privada.", paymaster: "PAYMASTER:", gas: "GAS ABSORBIDO" },
    roadmapItems: [["01", "LABORATORIO", "Pools eficientes, wallets embebidas y gas abstraído. Verificamos la base on-chain para que cada operación sea segura y simple."], ["02", "PRUEBA DE CONCEPTO", "Interfaz inicial, onboarding con passkey y pruebas end to end para validar el recorrido completo del usuario."], ["03", "PRODUCTO MÍNIMO VIABLE", "Mejoras de UI/UX para payments, finance y trading. Blockchain por detrás, arquitectura de sistemas y modelo de negocio."], ["04", "ON-RAMP + OFF-RAMP", "Entradas y salidas a moneda local. Expansión a mercados latinoamericanos, marketing y go to market."], ["05", "ECOSISTEMA COMPLETO", "Más activos, más redes y routing universal. Una wallet universal con un solo saldo para el futuro del dinero."]] ,
  },
  en: {
    nav: { proposal: "Proposal", how: "How it works", features: "Features", roadmap: "Roadmap", cta: "Try now" },
    hero: { plain: "A digital wallet where you keep your dollars, send them to anyone, and get paid through a link — all from your phone.", titleOne: "KEEP. SEND. GET PAID.", titleTwo: "FROM YOUR PHONE.", description: "One balance. Send to someone's @name or scan a QR; share a link and they pay from their own account. Ethereum, Monad and Solana — the app picks the network for you.", cta: "Try now Alpha Version" },
    problem: { title: "The problem", intro: "Saving in dollars is still a headache. ReWALLET removes all three frictions at once.", banks: "TRADITIONAL BANKS", banksText: "Your money loses value to inflation. Savings rates fall short.", wallets: "CRYPTO WALLETS", walletsText: "A list of words you cannot lose. You pick the network. You pay fees in a token you do not understand.", fintech: "FINTECH APPS", fintechText: "Multiple screens to do something simple." },
    solution: { eyebrow: "OUR SOLUTION", title: "One wallet. One balance. No extra steps.", intro: "ReWALLET is a digital wallet for paying and getting paid without learning crypto.", face: "Sign up with a passkey", faceText: "Verify your email and sign in with your phone fingerprint or face. No seed phrases, no passwords.", yield: "Yield, in testing", yieldText: "Depositing to earn yield has never been run with real money. We publish no figure.", sends: "Send by handle", sendsText: "Send money with someone's @name. No hex addresses." },
    tiers: [
      { id: "passkey", name: "SIGN UP WITH A PASSKEY", description: "Verify your email and sign in with your phone fingerprint or face. No seed phrases, no passwords.", features: ["Your wallet is created on sign-up", "You verify your email"] },
      { id: "receive", name: "RECEIVE", description: "Show your address and its QR code. Whoever pays you scans it and the money arrives.", features: ["One address to receive", "QR code included"] },
      { id: "yield", name: "YIELD", description: "Storing your money and earning yield on it is still in testing, inside the finance stage. We publish no figure until we run it with real money.", features: ["Still in testing", "No figure published"] },
      { id: "handle", name: "SEND BY HANDLE", description: "Send to @name, the ReWALLET handle. No long addresses, no choosing a network.", features: ["Just the other person's @name", "Ethereum, Monad and Solana"] },
      { id: "links", name: "PAYMENT LINKS", description: "Create a link and share it like a message. The other person pays from their own account.", features: ["Shared like a message", "They pay from their own account"] },
      { id: "activity", name: "ACTIVITY", description: "All your movements in one place, grouped by date.", features: ["One history", "Incoming and outgoing together"] },
      { id: "withdraw", name: "WITHDRAW TO LOCAL CURRENCY", description: "Cashing your dollars out into local money does not exist yet. It is stage 04 of the roadmap: On-ramp + Off-ramp.", features: ["Not available yet", "Roadmap stage 04"] },
      { id: "multinet", name: "ONE BALANCE, SEVERAL NETWORKS", description: "Ethereum, Monad and Solana on a single balance. The app decides which network each send goes through.", features: ["Ethereum, Monad and Solana", "You never pick the network"] },
      { id: "onramp", name: "TOP UP FROM YOUR BANK", description: "Getting in with money from a local bank is roadmap stage 04, not built yet.", features: ["Roadmap stage 04", "Local currency in and out"] },
    ],
    sections: { how: "// SECTION: HOW IT WORKS", features: "// SECTION: FEATURES", featuresTitle: "WHAT REWALLET DOES", featuresDescription: "What works today and what comes next. Every card says which stage we are at.", featuresNote: "* One balance. Several networks. No extra steps.", tierCta: "LEARN MORE", roadmap: "// SECTION: ROADMAP", roadmapTitle: "Today Monad. Tomorrow the full ecosystem.", roadmapDescription: "Five stages. Each adds capabilities without rewriting what came before.", architecture: "PLANNED ARCHITECTURE AND ENGINEERING", privateBeta: "// SECTION: PRIVATE ENTRY / PARTNERS", betaTitle: "The future of money starts today.", betaDescription: "ReWALLET is in private beta. We are looking for institutions and partners to join.", betaButton: "I want to try it", betaNote: "No commitment. No spam." },
    workflow: { left: ["Send", "Receive", "Save"], right: ["Grow", "Secure", "Global"] },
    stats: [
      { label: "01 / HANDLE", value: "@NAME" },
      { label: "02 / NETWORKS", value: "3" },
      { label: "03 / SIGN IN", value: "PASSKEY" },
      { label: "04 / BALANCE", value: "ONE" },
    ],
    manifest: { title: "How it works", subtitle: "without complexity", first: "What users do not see is what makes the difference. Every operation runs an on-chain choreography that users never see. The complexity exists, but it lives in the backend.", second: "TEE-embedded wallet. When you sign up, a custodial wallet is created in a Trusted Execution Environment. Users never see the private key.", paymaster: "PAYMASTER:", gas: "GAS ABSORBED" },
    roadmapItems: [["01", "LAB", "Efficient pools, embedded wallets, and abstracted gas. We verify the on-chain foundation so every operation is safe and simple."], ["02", "PROOF OF CONCEPT", "Initial interface, passkey onboarding, and end-to-end tests to validate the complete user journey."], ["03", "MINIMUM VIABLE PRODUCT", "UI/UX improvements for payments, finance, and trading. Blockchain underneath, systems architecture, and business model."], ["04", "ON-RAMP + OFF-RAMP", "Local currency in and out. Expansion across Latin American markets, marketing, and go-to-market."], ["05", "FULL ECOSYSTEM", "More assets, more networks, and universal routing. One universal wallet with one balance for the future of money."]] ,
  },
  pt: {
    nav: { proposal: "Proposta", how: "Como funciona", features: "Funcionalidades", roadmap: "Roteiro", cta: "Experimentar agora" },
    hero: { plain: "Uma carteira digital onde você guarda seus dólares, envia para qualquer pessoa e recebe por um link — tudo pelo celular.", titleOne: "GUARDE. ENVIE. RECEBA.", titleTwo: "DO CELULAR.", description: "Um único saldo. Envie para o @nome da pessoa ou escaneie um QR; compartilhe um link e recebe da própria conta dela. Ethereum, Monad e Solana — o app escolhe a rede por você.", cta: "Experimentar agora Versão Alpha" },
    problem: { title: "O problema", intro: "Guardar em dólares ainda é uma dor de cabeça. A ReWALLET elimina as três fricções ao mesmo tempo.", banks: "BANCOS TRADICIONAIS", banksText: "Seu dinheiro perde valor com a inflação. As taxas de poupança não acompanham.", wallets: "CARTEIRAS CRIPTO", walletsText: "Uma lista de palavras que você não pode perder. Você escolhe a rede. Paga taxas em um token que não entende.", fintech: "APPS DE FINTECH", fintechText: "Múltiplas telas para fazer algo simples." },
    solution: { eyebrow: "NÓS SOMOS A SOLUÇÃO", title: "Uma carteira. Um saldo. Nenhum passo a mais.", intro: "A ReWALLET é uma carteira digital para pagar e receber sem aprender cripto.", face: "Cadastro com passkey", faceText: "Você verifica seu e-mail e entra com a digital ou o rosto do celular. Sem sementes e sem senhas.", yield: "Rendimento em testes", yieldText: "O depósito que gera rendimento nunca foi rodado com dinheiro real. Não publicamos nenhuma cifra.", sends: "Envios por identificador", sendsText: "Envie dinheiro com o @nome da pessoa. Sem endereços hexadecimais." },
    tiers: [
      { id: "passkey", name: "CADASTRO COM PASSKEY", description: "Você verifica seu e-mail e entra com a digital ou o rosto do celular. Sem sementes e sem senhas.", features: ["A carteira é criada no cadastro", "Você verifica seu e-mail"] },
      { id: "receive", name: "RECEBER", description: "Mostre seu endereço e o código QR dele. Quem paga escaneia e o dinheiro chega.", features: ["Um endereço para receber", "QR code incluso"] },
      { id: "yield", name: "RENDIMENTO", description: "Guardar o dinheiro e gerar rendimento está em testes, dentro da etapa de finanças. Não publicamos nenhuma cifra até rodar com dinheiro real.", features: ["Ainda em testes", "Sem cifra publicada"] },
      { id: "handle", name: "ENVIAR POR IDENTIFICADOR", description: "Envie para @nome, o identificador da ReWALLET. Sem endereços longos e sem escolher rede.", features: ["Só o @nome da outra pessoa", "Ethereum, Monad e Solana"] },
      { id: "links", name: "LINKS DE COBRO", description: "Gere um link e compartilhe como uma mensagem. A outra pessoa paga da própria conta.", features: ["Compartilha como uma mensagem", "O outro paga da própria conta"] },
      { id: "activity", name: "ATIVIDADE", description: "Todos os seus movimentos em um só lugar, agrupados por data.", features: ["Histórico unificado", "Entradas e saídas juntas"] },
      { id: "withdraw", name: "SAQUE PARA MOEDA LOCAL", description: "Sacar seus dólares para dinheiro local ainda não existe. É a etapa 04 do caminho: On-ramp + Off-ramp.", features: ["Ainda não disponível", "Etapa 04 do roteiro"] },
      { id: "multinet", name: "UM SALDO, VÁRIAS REDES", description: "Ethereum, Monad e Solana em um único saldo. O app decide por qual rede vai cada envio.", features: ["Ethereum, Monad e Solana", "Você não escolhe a rede"] },
      { id: "onramp", name: "CARREGAR DO SEU BANCO", description: "Entrar com dinheiro do banco local é a etapa 04 do roteiro, ainda não construída.", features: ["Etapa 04 do roteiro", "Entrada e saída em moeda local"] },
    ],
    sections: { how: "// SEÇÃO: COMO FUNCIONA", features: "// SEÇÃO: FUNCIONALIDADES", featuresTitle: "O QUE A REWALLET FAZ", featuresDescription: "O que já funciona hoje e o que vem depois. Cada cartão diz em que etapa estamos.", featuresNote: "* Um saldo. Várias redes. Nenhum passo a mais.", tierCta: "SAIBA MAIS", roadmap: "// SEÇÃO: ROTEIRO", roadmapTitle: "Hoje Monad. Amanhã, o ecossistema completo.", roadmapDescription: "Cinco etapas. Cada uma adiciona capacidades sem reescrever as anteriores.", architecture: "ARQUITETURA E ENGENHARIA PLANEJADA", privateBeta: "// SEÇÃO: ENTRADA PRIVADA / SÓCIOS", betaTitle: "O futuro do dinheiro começa hoje.", betaDescription: "A ReWALLET está em beta privada. Buscamos instituições e parceiros para participar.", betaButton: "Quero experimentar", betaNote: "Sem compromisso. Sem spam." },
    workflow: { left: ["Enviar", "Receber", "Economizar"], right: ["Render", "Seguro", "Global"] },
    stats: [
      { label: "01 / IDENTIFICADOR", value: "@NOME" },
      { label: "02 / REDES", value: "3" },
      { label: "03 / ENTRADA", value: "PASSKEY" },
      { label: "04 / SALDO", value: "ÚNICO" },
    ],
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
