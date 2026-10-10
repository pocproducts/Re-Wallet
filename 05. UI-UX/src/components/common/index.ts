/*
 * ── Lo que este barril ya NO reexporta, y por qué ────────────────────────────
 *
 * `StatusBadge` y `SectionCard` se borraron: el único que los mencionaba era
 * esta misma lista, así que nunca llegaron a ninguna pantalla. Que un componente
 * "esté" por un `export *` no lo usa nadie: si nadie lo importa del módulo que
 * lo define, no existe para el producto.
 *
 * ── Una regla que vino del onboarding borrado y sigue viva ──────────────────
 *
 * El onboarding viejo (`components/Onboarding/OnboardingFlow.tsx`, ya eliminado)
 * tenía dos puertas: "Comenzar" y "Ya tengo cuenta". Para saber cuál mostrar
 * consultaba `POST /me/lookup` con `services/account.ts`, y el backend contestaba
 * `start_signup` cuando el correo no tenía cuenta.
 *
 * La regla que sobrevive a ese archivo, y que sigue siendo de seguridad y no de
 * redacción: **esta app nunca le dice a alguien que su correo no está
 * registrado.** Decirlo convierte la puerta de ingreso en un oráculo —con dos
 * correos alcanza para descubrir cuáles están dados de alta, que es información
 * de otra persona—. No es una preferencia de copy: es no filtrar.
 *
 * Hoy la pantalla de ingreso (`Auth/LoginGate`) ni siquiera pregunta: manda el
 * código y deja que Privy cree la cuenta o entre a la que existe, así que no
 * tiene nada que revelar. Si alguna vez se vuelve a preguntar por el estado de
 * una cuenta, el camino del "no" tiene que ser **indistinguible** del "sí": la
 * misma salida, el mismo silencio, cero texto sobre si el correo existe.
 *
 * La regla también acota los errores de Privy: `user_does_not_exist` y
 * `disallowed_login_method` (definidos en `services/privy.ts`) no se traducen a un
 * mensaje que diga que la cuenta no está, por la misma razón.
 *
 * Esto vive acá porque el archivo que lo reemplaza (`Auth/LoginGate.tsx`) queda
 * fuera de la pasada de limpieza; cuando se pueda tocar, el comentario se muda
 * a la cabecera de esa pantalla, que es donde lo va a leer quien trabaje en ella.
 */

export * from './AssetSheet';
export * from './AssetTradeCard';
export * from './BackButton';
export * from './NumericKeypad';
export * from './TradePairCard';
