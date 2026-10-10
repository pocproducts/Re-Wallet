import { useLanguage } from "@/components/language-provider"

const SOLUTIONS = [
  {
    title: "Registro con passkey",
    text: "Verificás tu email y entrás con la huella o el rostro de tu celular. Sin semillas y sin contraseñas.",
  },
  {
    title: "Rendimiento en pruebas",
    text: "El depósito que genera rendimiento todavía no se corrió con plata real. No publicamos ninguna cifra.",
  },
  {
    title: "Envíos por identificador",
    text: "Mandás a @nombre, el identificador de ReWALLET. No a una dirección hex. Compartís un link de cobro como si fuera un mensaje.",
  },
]

export function StatusCard() {
  const { language, copy } = useLanguage()
  const solution = language === "pt" ? copy.solution : language === "en" ? { eyebrow: "OUR SOLUTION", title: "One wallet. One balance. No extra steps.", intro: "ReWALLET is a digital wallet for paying and getting paid without learning crypto.", face: "Sign up with a passkey", faceText: "Verify your email and sign in with your phone fingerprint or face. No seed phrases, no passwords.", yield: "Yield, in testing", yieldText: "Depositing to earn yield has never been run with real money. We publish no figure.", sends: "Send by handle", sendsText: "Send to @name, the ReWALLET handle. Not to a hex address. Share a payment link like it is a message." } : { eyebrow: "NUESTRA SOLUCION", title: "Una billetera. Un saldo. Cero pasos raros.", intro: "ReWALLET es una billetera digital para pagar y cobrar sin aprender cripto.", face: "Registro con passkey", faceText: "Verificás tu email y entrás con la huella o el rostro de tu celular. Sin semillas y sin contraseñas.", yield: "Rendimiento en pruebas", yieldText: "El depósito que genera rendimiento todavía no se corrió con plata real. No publicamos ninguna cifra.", sends: "Envíos por identificador", sendsText: "Mandás a @nombre, el identificador de ReWALLET. No a una dirección hex. Compartís un link de cobro como si fuera un mensaje." }
  const cards = [
    { title: solution.face, text: solution.faceText },
    { title: solution.yield, text: solution.yieldText },
    { title: solution.sends, text: solution.sendsText },
  ]
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b-2 border-foreground px-4 py-2">
        <span className="text-[10px] tracking-widest text-muted-foreground uppercase">{solution.eyebrow}</span>
        <span className="text-[10px] tracking-widest text-muted-foreground uppercase">{solution.eyebrow}</span>
      </div>
      <div className="flex flex-1 flex-col gap-5 p-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">{solution.title}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{solution.intro}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((solution) => (
            <article key={solution.title} className="border-t-2 border-foreground pt-3">
              <h3 className="text-sm font-bold tracking-tight text-foreground">{solution.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{solution.text}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
