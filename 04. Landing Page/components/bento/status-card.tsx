import { useLanguage } from "@/components/language-provider"

const SOLUTIONS = [
  {
    title: "Face ID como login",
    text: "Tu cara es tu contraseña. Sin semillas, sin passwords, sin fricción. La wallet se crea automáticamente en 10 segundos.",
  },
  {
    title: "Rendimiento automático",
    text: "Cada dólar depositado va automáticamente a un pool de liquidez. El interés compuesto se acredita todos los días. Sin staking manual.",
  },
  {
    title: "Envíos por tag",
    text: "Mandá dinero a @carlos, un email o un teléfono. No a una dirección hex. Compartí un link de cobro como si fuera un mensaje.",
  },
]

export function StatusCard() {
  const { language, copy } = useLanguage()
  const solution = language === "pt" ? copy.solution : language === "en" ? { eyebrow: "OUR SOLUTION", title: "One account. One balance. Zero complexity.", intro: "ReWALLET is the first digital dollar account designed for people who have never touched crypto.", face: "Face ID login", faceText: "Your face is your password. No seed phrases, no passwords, no friction.", yield: "Automatic yield", yieldText: "Every deposited dollar automatically goes to a liquidity pool. Compound interest is credited daily.", sends: "Send by tag", sendsText: "Send money to @carlos, an email, or a phone number. No hex address required." } : { eyebrow: "NUESTRA SOLUCION", title: "Una cuenta. Un saldo. Cero complejidad.", intro: "ReWALLET es la primera cuenta en dólares digitales diseñada para el usuario que nunca tocó cripto.", face: "Face ID como login", faceText: "Tu cara es tu contraseña. Sin semillas, sin passwords, sin fricción.", yield: "Rendimiento automático", yieldText: "Cada dólar depositado va automáticamente a un pool de liquidez. El interés compuesto se acredita todos los días.", sends: "Envíos por tag", sendsText: "Mandá dinero a @carlos, un email o un teléfono. No a una dirección hex." }
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
