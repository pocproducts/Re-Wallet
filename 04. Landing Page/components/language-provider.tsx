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
    nav: { proposal: "Propuesta", how: "Arquitectura", features: "Funcionalidades", roadmap: "Hoja de ruta", cta: "Probar ahora" },
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
      { id: "withdraw", name: "RETIRO A MONEDA LOCAL", description: "Sacar tus dólares a dinero local todavía no existe. Es la etapa 3 del roadmap: entrada y salida a moneda local.", features: ["No está disponible todavía", "Etapa 3 del roadmap"] },
      { id: "multinet", name: "UN SALDO, VARIAS REDES", description: "Ethereum, Monad y Solana en un solo saldo. La app decide por cuál red va cada envío.", features: ["Ethereum, Monad y Solana", "No elegís la red"] },
      { id: "onramp", name: "CARGAR DESDE TU BANCO", description: "Entrar con dinero de banco local viene junto con el retiro, en la etapa 3 del roadmap. Todavía no está construido.", features: ["Etapa 3 del roadmap", "Entrada y salida a moneda local"] },
    ],
    sections: { how: "// SECCION: ARQUITECTURA (OPCIONAL)", features: "// SECCION: FUNCIONALIDADES", featuresTitle: "QUÉ HACE REWALLET", featuresDescription: "Lo que ya funciona hoy y lo que viene después. Cada tarjeta dice en qué etapa estamos.", featuresNote: "* Un solo saldo. Varias redes. Cero pasos raros.", tierCta: "CONOCER MÁS", roadmap: "// SECCION: DONDE ESTAMOS Y QUE SIGUE", roadmapTitle: "Lo que ya anda, y lo que sigue.", roadmapDescription: "La etapa 1 está en manos de la gente. La etapa 2 es multichain, swaps y bridges. Después, el retiro a moneda local, que necesita licencias y un proveedor de entrada y salida.", architecture: "SI TE IMPORTA COMO ESTA HECHO", privateBeta: "// SECCION: ACCESO A LA ALPHA", betaTitle: "Entrá a la alpha.", betaDescription: "ReWALLET está en alpha privada. Dejanos tu email y te avisamos cuando abramos el acceso.", betaButton: "Quiero probarlo", betaNote: "Sin compromiso. Sin spam." },
    workflow: { left: ["Enviar", "Recibir", "Ahorrar"], right: ["Rendir (test)", "Seguro", "Global"] },
    stats: [
      { label: "01 / IDENTIFICADOR", value: "@NOMBRE" },
      { label: "02 / REDES", value: "3" },
      { label: "03 / INGRESO", value: "PASSKEY" },
      { label: "04 / SALDO", value: "ÚNICO" },
    ],
    manifest: { title: "Cómo está hecho", subtitle: "por si te interesa", first: "No tenés ni clave ni contraseña que custodiar: tu cuenta se crea sola cuando te registrás con tu email y la huella de tu celular. Por debajo, cada envío coordina varios pasos y los resuelve el backend. Para vos es un botón; la complejidad vive atrás.", second: "Tus dólares se guardan en un TEE, un tipo de servidor aislado donde nadie —ni siquiera nosotros— puede leer tu clave. Nunca la ves ni la tocás. Y el paymaster es el componente que paga por vos las comisiones de la red: vos no configurás comisiones ni las pagás. Si usarla te alcanza, ya la estás usando.", paymaster: "PAYMASTER (PAGA LAS COMISIONES POR VOS):", gas: "COMISIONES QUE NO PAGAS" },
    roadmapItems: [["01", "ETAPA 1 — YA ESTÁ", "Registro con passkey. Un solo saldo sobre Ethereum, Monad y Solana. Envío por @nombre o por QR. Links de cobro. Historial de movimientos."], ["02", "ETAPA 2 — MULTICHAIN, SWAPS Y BRIDGES", "Intercambiar dentro de ReWALLET (USDC ↔ USDT0 en Monad) y mover el saldo entre redes. El contrato ya está definido; falta activar el adaptador."], ["03", "ETAPA 3 — RETIRO A MONEDA LOCAL", "Sacar los dólares a dinero local. Necesita licencias y un proveedor de entrada y salida. Hoy no existe."], ["•", "RENDIMIENTO — EN PRUEBAS", "El depósito que rinde se activa solo y se suma al saldo, y se puede sacar en cualquier momento. Nunca lo corrimos con plata real: por eso no publicamos ninguna cifra."]] ,
  },
  en: {
    nav: { proposal: "Proposal", how: "Architecture", features: "Features", roadmap: "Roadmap", cta: "Try now" },
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
      { id: "withdraw", name: "WITHDRAW TO LOCAL CURRENCY", description: "Cashing your dollars out into local money does not exist yet. It is stage 3 of the roadmap: local currency in and out.", features: ["Not available yet", "Roadmap stage 3"] },
      { id: "multinet", name: "ONE BALANCE, SEVERAL NETWORKS", description: "Ethereum, Monad and Solana on a single balance. The app decides which network each send goes through.", features: ["Ethereum, Monad and Solana", "You never pick the network"] },
      { id: "onramp", name: "TOP UP FROM YOUR BANK", description: "Getting in with money from a local bank comes together with the withdrawal, in roadmap stage 3. Not built yet.", features: ["Roadmap stage 3", "Local currency in and out"] },
    ],
    sections: { how: "// SECTION: ARCHITECTURE (OPTIONAL)", features: "// SECTION: FEATURES", featuresTitle: "WHAT REWALLET DOES", featuresDescription: "What works today and what comes next. Every card says which stage we are at.", featuresNote: "* One balance. Several networks. No extra steps.", tierCta: "LEARN MORE", roadmap: "// SECTION: WHERE WE ARE AND WHAT IS NEXT", roadmapTitle: "What already works, and what comes next.", roadmapDescription: "Stage 1 is in people's hands. Stage 2 is multi-chain, swaps and bridges. After that, local-currency withdrawal, which needs licences and an on/off-ramp provider.", architecture: "IF YOU CARE HOW IT IS BUILT", privateBeta: "// SECTION: ALPHA ACCESS", betaTitle: "Get into the alpha.", betaDescription: "ReWALLET is in private alpha. Leave your email and we will tell you when access opens.", betaButton: "I want to try it", betaNote: "No commitment. No spam." },
    workflow: { left: ["Send", "Receive", "Save"], right: ["Grow (test)", "Secure", "Global"] },
    stats: [
      { label: "01 / HANDLE", value: "@NAME" },
      { label: "02 / NETWORKS", value: "3" },
      { label: "03 / SIGN IN", value: "PASSKEY" },
      { label: "04 / BALANCE", value: "ONE" },
    ],
    manifest: { title: "How it is built", subtitle: "if you care", first: "There is no key and no password for you to keep: your account is created when you sign up with your email and your phone fingerprint. Underneath, every send coordinates several steps and the backend resolves them. For you it is one button; the complexity lives behind it.", second: "Your dollars sit in a TEE, an isolated kind of server where nobody — not even us — can read your key. You never see or touch it. And the paymaster is the component that pays the network fees on your behalf: you set no fees and pay none. If using it is enough for you, you are already using it.", paymaster: "PAYMASTER (PAYS NETWORK FEES FOR YOU):", gas: "FEES YOU DO NOT PAY" },
    roadmapItems: [["01", "STAGE 1 — SHIPPED", "Passkey sign-up. One balance across Ethereum, Monad and Solana. Send by @name or by QR. Payment links. Movement history."], ["02", "STAGE 2 — MULTI-CHAIN, SWAPS AND BRIDGES", "Swap inside ReWALLET (USDC ↔ USDT0 on Monad) and move the balance across networks. The contract is already defined; the adapter still has to be switched on."], ["03", "STAGE 3 — LOCAL CURRENCY WITHDRAWAL", "Cash your dollars out into local money. It needs licences and an on/off-ramp provider. It does not exist today."], ["•", "YIELD — IN TESTING", "The deposit that earns starts on its own and lands in your balance, and you can take it out at any time. We have never run it with real money: that is why we publish no figure."]] ,
  },
  pt: {
    nav: { proposal: "Proposta", how: "Arquitetura", features: "Funcionalidades", roadmap: "Roteiro", cta: "Experimentar agora" },
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
      { id: "withdraw", name: "SAQUE PARA MOEDA LOCAL", description: "Sacar seus dólares para dinheiro local ainda não existe. É a etapa 3 do roteiro: entrada e saída em moeda local.", features: ["Ainda não disponível", "Etapa 3 do roteiro"] },
      { id: "multinet", name: "UM SALDO, VÁRIAS REDES", description: "Ethereum, Monad e Solana em um único saldo. O app decide por qual rede vai cada envio.", features: ["Ethereum, Monad e Solana", "Você não escolhe a rede"] },
      { id: "onramp", name: "CARREGAR DO SEU BANCO", description: "Entrar com dinheiro do banco local vem junto com o saque, na etapa 3 do roteiro. Ainda não está construído.", features: ["Etapa 3 do roteiro", "Entrada e saída em moeda local"] },
    ],
    sections: { how: "// SEÇÃO: ARQUITETURA (OPCIONAL)", features: "// SEÇÃO: FUNCIONALIDADES", featuresTitle: "O QUE A REWALLET FAZ", featuresDescription: "O que já funciona hoje e o que vem depois. Cada cartão diz em que etapa estamos.", featuresNote: "* Um saldo. Várias redes. Nenhum passo a mais.", tierCta: "SAIBA MAIS", roadmap: "// SEÇÃO: ONDE ESTAMOS E O QUE VEM", roadmapTitle: "O que já funciona, e o que vem depois.", roadmapDescription: "A etapa 1 está nas mãos das pessoas. A etapa 2 é multichain, swaps e bridges. Depois, o saque para moeda local, que precisa de licenças e de um provedor de entrada e saída.", architecture: "SE VOCE SE IMPORTA COMO ESTA FEITO", privateBeta: "// SEÇÃO: ACESSO À ALPHA", betaTitle: "Entre na alpha.", betaDescription: "A ReWALLET está em alpha privada. Deixe seu e-mail e avisamos quando o acesso abrir.", betaButton: "Quero experimentar", betaNote: "Sem compromisso. Sem spam." },
    workflow: { left: ["Enviar", "Receber", "Economizar"], right: ["Render (test)", "Seguro", "Global"] },
    stats: [
      { label: "01 / IDENTIFICADOR", value: "@NOME" },
      { label: "02 / REDES", value: "3" },
      { label: "03 / ENTRADA", value: "PASSKEY" },
      { label: "04 / SALDO", value: "ÚNICO" },
    ],
    manifest: { title: "Como foi feito", subtitle: "se você se importa", first: "Você não tem chave nem senha para guardar: sua conta nasce quando você se cadastra com o e-mail e a digital do celular. Por baixo, cada envio coordena vários passos e o backend resolve. Para você é um botão; a complexidade fica atrás.", second: "Seus dólares ficam em uma TEE, um tipo de servidor isolado onde ninguém — nem nós — consegue ler sua chave. Você nunca a vê nem encosta nela. E o paymaster é o componente que paga as taxas da rede por você: você não configura taxa nenhuma. Se usar já basta, você já está usando.", paymaster: "PAYMASTER (PAGA AS TAXAS POR VOCÊ):", gas: "TAXAS QUE VOCÊ NÃO PAGA" },
    roadmapItems: [["01", "ETAPA 1 — JÁ ESTÁ", "Cadastro com passkey. Um único saldo sobre Ethereum, Monad e Solana. Envio por @nome ou por QR. Links de cobrança. Histórico de movimentos."], ["02", "ETAPA 2 — MULTICHAIN, SWAPS E BRIDGES", "Trocar dentro da ReWALLET (USDC ↔ USDT0 em Monad) e mover o saldo entre redes. O contrato já está definido; falta ativar o adaptador."], ["03", "ETAPA 3 — SAQUE PARA MOEDA LOCAL", "Sacar os dólares para dinheiro local. Precisa de licenças e de um provedor de entrada e saída. Hoje não existe."], ["•", "RENDIMENTO — EM TESTES", "O depósito que rende começa sozinho e entra no saldo, e pode ser sacado a qualquer momento. Nunca rodamos com dinheiro real: por isso não publicamos nenhuma cifra."]] ,
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
