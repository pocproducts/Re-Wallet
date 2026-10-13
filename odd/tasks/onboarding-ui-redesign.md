# Feature: Rediseño del onboarding (maqueta dark/neón)

## Objetivo
Aplicar la estética de la maqueta HTML provista (fondo #0A0A0A, neón #D4FF00, Inter, botones píldora) al flujo de ingreso, **sin tocar la lógica de Privy ni del backend**.

## Reglas
- Solo estética + la pantalla de bienvenida nueva.
- "Crear cuenta" y "Ya tengo una cuenta" hacen lo mismo: llevan al paso de correo → OTP (es lo que Privy hace igual; la maqueta lo dice explícito).
- Mantener intactos: `sendCode`/`loginWithCode`, `reportPrivyError`, cuenta regresiva por prop, pegado de código, guards `ready`/`authenticated`.

## Tareas
- [ ] 1. Rediseñar `LoginGate.tsx`: etapa previa "bienvenida" (logo, claim, 2 botones que van al paso correo), resto del flujo igual, estilo dark/neón.
- [ ] 2. Rediseñar `CodeVerification.tsx`: casillas OTP estilo maqueta (fondo #1C1C1E, borde neón al focus/lleno), header con back + chip de correo, link de reenvío con countdown; misma API de props.
- [ ] 3. Build del front (`npm run build` en `05. UI-UX`) y verificación de tipos.

## Notas
- `App.tsx` no se toca: renderiza `<LoginGate />` y el componente decide sus etapas.
- Token neón del proyecto (#ccff00) vs maqueta (#D4FF00): usar un solo valor dark/teal coherente, documentado en el componente.
