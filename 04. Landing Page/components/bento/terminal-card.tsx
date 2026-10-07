import { useLanguage } from "@/components/language-provider"

export function TerminalCard() {
  const { language, copy } = useLanguage()
  const problem = language === "pt" ? copy.problem : language === "en" ? { title: "The problem", intro: "Saving in dollars is still a headache. ReWALLET removes all three frictions at once.", banks: "TRADITIONAL BANKS", banksText: "Your money loses value to inflation. Savings rates fall short.", wallets: "CRYPTO WALLETS", walletsText: "A list of words you cannot lose. You pick the network. You pay fees in a token you do not understand.", fintech: "FINTECH APPS", fintechText: "Multiple screens to do something simple." } : { title: "El problema", intro: "Ahorrar en dólares todavía es un dolor de cabeza. ReWALLET elimina las tres fricciones al mismo tiempo.", banks: "BANCOS TRADICIONALES", banksText: "Tu dinero pierde valor con la inflación. Las tasas de ahorro no alcanzan.", wallets: "WALLETS CRIPTO", walletsText: "Una lista de palabras que no podés perder. Vos elegís la red. Pagás comisiones en un token que no entendés.", fintech: "APPS DE FINTECH", fintechText: "Múltiples pantallas para hacer algo simple." }
  return (
    <div id="problema" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b-2 border-foreground px-4 py-2"><span className="text-[10px] tracking-widest text-muted-foreground uppercase">PROBLEMA</span><span className="text-[10px] tracking-widest text-[#ea580c]">01 / 03</span></div>
      <div className="flex flex-col gap-5 p-5 lg:p-6">
        <div><h3 className="text-xl lg:text-2xl font-mono font-bold uppercase tracking-tight">{problem.title}</h3><p className="mt-2 text-xs font-mono leading-relaxed text-muted-foreground">{problem.intro}</p></div>
        {[
          [problem.banks, problem.banksText],
          [problem.wallets, problem.walletsText],
          [problem.fintech, problem.fintechText],
        ].map(([title, description]) => <div key={title} className="border-t-2 border-foreground pt-3"><h4 className="text-[10px] font-mono font-bold tracking-[0.15em]">{title}</h4><p className="mt-2 text-xs font-mono leading-relaxed text-muted-foreground">{description}</p></div>)}
      </div>
    </div>
  )
}
