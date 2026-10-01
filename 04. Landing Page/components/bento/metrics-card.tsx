"use client"

export function MetricsCard() {
  return (
    <div id="como-funciona" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b-2 border-foreground px-4 py-2">
        <span className="text-[10px] tracking-widest text-muted-foreground uppercase">NOCION DE LA SOLUCION</span>
        <span className="inline-block h-2 w-2 bg-[#ea580c]" />
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden bg-background p-4">
        <img
          src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ChatGPT%20Image%20Sep%2030%2C%202026%2C%2005_39_00%20PM-UWlXD7HVoq3Eyzx5T6a4P5ZCUeZ71C.png"
          alt="Red abstracta de conexiones que representa la solución digital de ReWALLET"
          className="h-full min-h-[240px] w-full object-cover"
        />
      </div>
    </div>
  )
}
