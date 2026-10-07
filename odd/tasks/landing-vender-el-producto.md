# Landing: vender el producto, no la estrategia

## Por qué esta tarea

La landing tiene **dos audiencias en un mismo documento** y corta a la mitad. Arriba
vende bien al usuario no nativo; abajo es un pitch deck:

| Sección | Copy actual |
| --- | --- |
| Features | **"CONOCE CÓMO OPERAMOS"** |
| Manifest | *"coreografía de pasos on-chain"*, **TEE**, **PAYMASTER**, **GAS ABSORBIDO** |
| Roadmap | 5 etapas: LABORATORIO → POC → MVP → ON-RAMP → ECOSISTEMA |
| Arquitectura | **"ARQUITECTURA E INGENIERÍA PLANTEADA"** |

Más `topology-graph`, `workflow-diagram` y `glitch-marquee`: todo diagrama de
infraestructura.

Vamos a un track de **consumer payments, finance y trading**. Quien juzga necesita
ver el producto, no la coreografía.

## El problema urgente: la landing promete más que la app

Esto es lo que más pesa en un track de producto, porque quien juzga **prueba la
app**:

| La landing promete | La app hace |
| --- | --- |
| "Login con **FACE ID**" (etiqueta CORE) | Correo + **passkey**. Face ID es un passkey a nivel de dispositivo, no lo que el texto dice |
| "**RETIRÁ cuando quieras**. Sin locks" | El off-ramp es **Fase 3**. No existe |
| "RENDIMIENTO **~4-5% anual**" (etiqueta CORE) | El depósito en Aave existe y **nunca se probó**. La cifra es escrita a mano |
| "Mandá a **@carlos, un email o un teléfono**" | Solo el identificador de ReWALLET. Ni email ni teléfono |
| "Wallet creada automáticamente" | Sí |

La etiqueta **CORE** está puesta sobre Face ID y sobre Rendimiento. **Dos de los
tres CORE no son reales.** Eso no es un detalle de copy: es la categoría que el
lector usa para decidir qué creer.

## Decisiones

1. **Una sola página.** La estrategia no se borra: **baja al final del scroll**.
   Los jueces de infraestructura la van a buscar, y si está, la encuentran. Quien
   solo lee los primeros tres bloques no la necesita.

2. **Se vende lo que anda, y se dice hasta dónde.** Las promesas que todavía no
   existen pasan al roadmap, con su etapa. Nada de "próximamente" pegado a una
   promesa: o es de hoy, o es de la etapa 2, con nombre.

3. **Fase 2 es multichain + swap + bridges.** El roadmap lo nombra así.

4. **Capturas antes que video.** Un video no lo lee un juez que evalúa con IA, y
   cuesta mucho más que dos capturas. Las capturas van primero; el video solo si
   sobra tiempo.

5. **Una sola promesa, dicha de una forma que se pueda verificar.** El juez
   evalúa con un modelo: una afirmación comprobable vale más que tres adjetivos.

## Qué hay que cambiar

### Arriba — el producto

- **Hero.** Dice "Dólares. Rindiendo. Al momento." Rindiendo no está probado. El
  hero tiene que decir **qué es** y **qué ya hace**, y tiene que sobrevivir a que
  alguien lo lea sin contexto.
- **Feature grid.** Los ocho cards se reescriben. Tres cosas de una vez: lo que es
  verdad hoy, lo que es verdad y está sin probar, y lo que es de la etapa 2. El
  `tag: "CORE"` solo puede quedar sobre lo que funciona.
  - **CORE, es cierto y comprobable:** envío por identificador, link de cobro,
    depósito con dirección propia, historial.
  - **Sin etiqueta o con la de la etapa:** rendimiento (sin cifra), retiro a
    moneda local, más activos.
- **Una frase sin una sola palabra cripto**, arriba de todo, que alguien de 40
  años entienda en una lectura.

### Al final — la estrategia

- El manifest se reescribe en humano o baja. **"TEE" y "paymaster" no son el
  idioma de un usuario no nativo**; si quedan, quedan abajo y con una frase que los
  traduzca.
- El roadmap pasa a decir **dónde estamos hoy y qué viene**, con Fase 1 cerrada y
  Fase 2 —multichain, swap, bridges— nombrada.

### CTA

- "Probar ahora" va a la app, que ya es lo que hace. Ningún cambio de
  comportamiento.
- Se saca el CTA de buscar "instituciones y partners" del camino principal: es un
  investor, no el usuario que un track de consumo quiere ver entrar.

## Allowed edit surfaces

- `04. Landing Page/components/**`
- `04. Landing Page/app/**`
- `04. Landing Page/public/**`
- `04. Landing Page/README.md`
- `odd/tasks/landing-vender-el-producto.md`

## Registro de avance

### L1 — Copy del producto (hecho)

- Frase sin vocabulario cripto arriba de todo (`copy.hero.plain`) y hero reescrito.
- Los 9 cards de `pricing-section.tsx` salen del array hardcodeado y pasan a
  `copy.tiers`, con su version en ES/EN/PT. Solo quedan en el componente el badge
  (`CORE` / `NEXT`) y el resaltado.
- Se borra `~4-5% anual`, `Face ID`, `@carlos, un email o un teléfono`,
  "Retirá cuando quieras" y "Dólares, Bitcoin, Ethereum".
- Los cuatro cards no verificables (rendimiento, retiro, off-ramp y multi-activo)
  quedan como estado futuro con nombre de etapa.
- `CONOCE CÓMO OPERAMOS` pasa a ser `QUÉ HACE REWALLET`.
- **Pendiente, fuera de las superficies autorizadas:** `app/layout.tsx` — los metadatos
  siguen diciendo "Cuenta en dólares digitales que rinde", "hacer rendir tu dinero",
  "Login con Face ID", "wallet embebida en TEE", "rendimiento automático" y el título
  "Dólares. Rindiendo. Al momento.". Es lo que se ve al compartir el link, y no tiene
  corrección posible sin abrir esa superficie.

### L1b — Segundo turno: bento + throughput (hecho)

- `components/bento/status-card.tsx` y `components/bento/terminal-card.tsx`: se cambian
  las palabras, no el cableado. Sigue siendo un literal por idioma dentro del componente,
  salvo el `pt` que lee el registro. Se fueron "Face ID", "tu cara es tu contraseña",
  "la wallet se crea en 10 segundos", "el interés compuesto se acredita todos los días",
  "cada dólar ... pool de liquidez", "@carlos, un email o un teléfono",
  "elegir entre 20 redes" y "la primera cuenta en dólares digitales".
  El `SOLUTIONS` del status-card es código muerto desde antes: se actualizaron sus
  palabras pero no se tocó su estructura.
- `pricing-section.tsx`: eliminado el contador `live throughput: XXk req/s`
  (`Math.random()` sobre un timer). Se fue el componente `StatusLine` y su único uso.
  El encabezado de sección queda con el título y la descripción, sin columna derecha.
- Contadores en `out/index.html` después de este turno: ver sección L1c.

### L2 — Orden y encuadre (hecho)

- **Reorden.** `Navbar → Hero → FeatureGrid → PricingSection (producto) → AboutSection → RoadmapSection → Footer`.
  `PricingSection` se partió en **dos exports del mismo archivo** (`PricingSection` = grilla de producto,
  `RoadmapSection` = hoja de ruta + acceso a la alpha) para que la arquitectura quedara entre el producto
  y el plan. Mismo markup, mismo CSS; no hay archivos nuevos. `id="roadmap"` y `id="pricing-tiers"` intactos,
  así que los links del navbar siguen funcionando. `nav.how` pasó a decir **"Arquitectura"** en los tres
  idiomas, porque `#solución` ahora es el bloque opcional del stack.
- **El CTA "Probar ahora" no se movió:** sigue en el hero, primer bloque del scroll.
- **Manifest en humano, con los términos traducidos al lado.** Se conservan **TEE** y **paymaster**, pero
  cada uno lleva su oración: el TEE es "un tipo de servidor aislado donde nadie puede leer tu clave", el
  paymaster es "el componente que paga las comisiones de la red por vos". `PAYMASTER:` / `GAS ABSORBIDO`
  pasaron a `PAYMASTER (PAGA LAS COMISIONES POR VOS):` / `COMISIONES QUE NO PAGAS`.
- **Hoja de ruta reescrita:** hoy y después, con la **etapa 2 nombrada** — multichain, swaps y bridges.
  Las cinco etapas de pitch (LABORATORIO → ECOSISTEMA) se fueron. Quedaron cuatro filas: etapa 1 (lo que
  está en manos de la gente), etapa 2 (multichain, swaps y bridges), etapa 3 (retiro a moneda local) y
  rendimiento, que va **sin número de etapa** porque todavía no se le asignó una.
- **Los tiers de L1 decían "etapa 04"** para retiro y carga desde el banco. `docs/contrato-dinero.md`
  dice que el retiro a moneda local es **Fase 3**, así que los dos cards pasaron a etapa 3. La carga desde
  el banco no tiene etapa asignada en el contrato: quedó escrita como "junto con el retiro, en la etapa 3".
- **`GlitchMarquee` saiu de la página.** Decía `// ALIADOS` sobre los logos de OpenAI, Anthropic, Google,
  Meta, NVIDIA, Mistral, Cohere, Stability, DeepMind y Hugging Face: no hay ningún acuerdo con ninguna de
  esas empresas, y en un track donde el juez prueba el producto eso es la primera cosa que se cae.
  No era ni copy ni orden — era una afirmación falsa. **El componente queda en el repo, sin borrar**, por
  si se quiere recuperar con otro encuadre; `components/glitch-marquee.tsx` no se tocó.
- **El nodo "Rendir" del hero** pasó a **"Rendir (test)"** (`Grow (test)` / `Render (test)`). Yield nunca
  se corrió con plata real y el diagrama está arriba de todo, en el hero: no puede decir "Rendir" a secas.
- **El CTA de instituciones y partners se desinstitucionalizó:** `betaTitle` "Entrá a la alpha.",
  y `betaDescription` pide el email para avisar cuándo se abre el acceso. El formulario se queda —es el
  único punto de conversión de la página— pero ya no le habla a un inversor.

### L3 — Showcase: una captura real y los huecos nombrados (hecho)

- Decisión 4 aplicada al revés de lo habitual: **no hay video y no hay mockups**. Entra `components/showcase-section.tsx`, entre `FeatureGrid` y `PricingSection`. El CTA "Probar ahora" sigue en el hero, primer bloque del scroll.
- **Una sola captura real**: `public/product/01-entrar.png` (390x844), servida con `next/image` como el resto de las imágenes de `public/` (`about-section.tsx`), con `alt` en los tres idiomas.
- **Los otros cuatro slots se renderizan como huecos explícitos**: cada fila nombra la pantalla, dice qué muestra y dice que la captura está pendiente. No hay dibujo de pantalla en ningún slot.
- El encabezado no promete nada que la imagen no pruebe: `MOSTRAMOS LO QUE HAY, NO LO QUE PROMETEMOS` (`WE SHOW WHAT EXISTS, NOT WHAT WE PROMISE` / `MOSTRAMOS O QUE EXISTE, NÃO O QUE PROMETEMOS`). La etiqueta de la sección dice `CAPTURA REAL` en el lugar donde las otras secciones ponen su número de orden, para no inventar una ordinal que ya está repetida en `pricing-section.tsx` (005 y 006 aparecen dos veces).
- **Cero números** en toda la sección, verificado sobre el HTML exportado.
- `public/product/README.md`: tabla con lo que falta capturar, a 390 px, sin datos reales, y el procedimiento para reemplazar un hueco por su captura en los tres idiomas.

### Fuera de alcance (sigue)

- `topology-graph.tsx` está **muerto**: no lo importa nadie. No se tocó.
- `components/bento/*` y `hero-section.tsx`, `feature-grid.tsx`, `footer.tsx` no necesitaron cambios.


### L1c — Metadatos y STATS (hecho)

- `app/layout.tsx`, metadata solamente: `title`, `description`, `keywords`,
  `openGraph.title/description` y `twitter.title/description`. Se fueron
  "Cuenta en dólares digitales que rinde", "Dólares. Rindiendo. Al momento.",
  "Login con Face ID", "wallet embebida en TEE", "rendimiento automático",
  "gas absorbido por paymaster" y las keywords de infraestructura.
  `openGraph.title` y `twitter.title` se eligieron a mano: los previews se escanean,
  no se leen, así que van cortos ("Guardá. Enviá. Cobrá."). El `title` de documento
  es el único campo que un buscador indexa, así que va descriptivo
  ("Guardá, enviá y cobrá en dólares").
- `about-section.tsx`: los labels de `STATS` (y los valores) salen del componente
  y pasan a `copy.stats` en los tres idiomas. Solo labels y valores, misma grilla.
- Estado del export: `Face ID` 0, `rendimiento automático` 0, `Rindiendo` 0,
  `4-5%` 0, `compuesto` 0, `live throughput` 0, `@carlos` 0, `20 redes` 0.
  Queda `TEE` 1, `wallet embebida` 1, `paymaster` 1, `gas absorbido` 1, todos en
  `copy.manifest`, que es el bloque de arquitectura y es L2.
- Basura no versionada que hay que limpiar a mano: `04. Landing Page/pnpm-workspace.yaml`
  (la creo el install disparado por `pnpm build` del primer turno; nadie tiene
  permiso de borrarla en este flujo) y `04. Landing Page/tsconfig.tsbuildinfo`
  (lo genera `npx tsc --noEmit`).

## Fuera de alcance

- **No se cambia el diseño, los colores ni los componentes.** Es una reescritura
  de copy y un reorden de secciones. Si algo necesita maquetación nueva, se
  pregunta antes.
- No se tocan los links ni el destino del CTA "Probar ahora".
- No se inventan métricas, tasas ni cifras. **Ninguna.**
- No se borra la sección de arquitectura: baja.