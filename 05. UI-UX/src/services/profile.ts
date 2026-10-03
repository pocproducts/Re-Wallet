/**
 * El perfil de la app sale de **la identidad de Privy**, no de un formulario.
 *
 * ── Por qué existe esta función ──────────────────────────────────────────────
 *
 * Antes el perfil venía de `OnboardingFlow`, que le pasaba a `App` un
 * `UserProfileData` armado a mano y guardado en `localStorage`. Con la puerta
 * de correo no hay formulario: hay un usuario de Privy, y sus datos son los que
 * existen. Esta función es el **único** lugar donde se decide qué se muestra de
 * ese usuario, para que `App` no tenga que inventivear nada.
 *
 * ── Nada de esto se persiste ─────────────────────────────────────────────────
 *
 * El perfil vive en memoria, derivado del usuario de Privy que el SDK ya tiene
 * en memoria. No hay `localStorage`: escribir el correo de una persona en
 * storage del navegador es guardar dato personal en un lugar que cualquier
 * script de la página lee.
 */
import type { User } from '@privy-io/react-auth';
import { UserProfileData } from '../types';

/** Lo que se muestra cuando Privy no tiene un nombre: "No informado". */
const SIN_NOMBRE = 'No informado';

/**
 * El nombre visible sale del nombre real si existe, y si no de la parte del
 * correo que la persona eligió herself.
 *
 * **No se inventa un nombre.** Con Privy y login por correo la cuenta no trae
 * nombre propio: lo único que la persona escribió fue el correo. Sacar el
 * nombre de ahí no es inventar, es mostrar lo que ella eligió, y `laura.gomez`
 * se lee como "Laura Gomez" en la billetera. Cuando Privy sí traiga nombre
 * (metadata o cuenta OAuth futura), ese gana.
 */
const readableNameFromEmail = (email: string): string => {
  const local = email.split('@')[0] ?? '';
  const words = local
    .split(/[._\-+\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  return words.length > 0 ? words.join(' ') : SIN_NOMBRE;
};

/** El nombre propio de la cuenta, si Privy lo tiene en alguna parte. */
const readRealName = (user: User): string | null => {
  const metadata = user.customMetadata as Record<string, unknown> | undefined;
  const candidatos = ['name', 'nombre', 'displayName', 'full_name'];

  for (const clave of candidatos) {
    const valor = metadata?.[clave];
    if (typeof valor === 'string' && valor.trim().length > 0) return valor.trim();
  }

  return null;
};

/**
 * El correo: primero el campo propio de Privy, y si no, la cuenta de correo
 * entre las cuentas vinculadas.
 *
 * No se devuelve `''` nunca si hay un usuario de Privy: un usuario sin correo
 * es un caso que la puerta de correo no puede producir (o se entró con otro
 * método, que hoy no existe). Si ocurre, se cae al `''` y las tres vistas ya
 * saben mostrar un estado sin dato.
 */
const readEmail = (user: User): string => {
  if (user.email?.address) return user.email.address;

  const linked = user.linkedAccounts.find(
    (cuenta) => cuenta.type === 'email' && 'address' in cuenta,
  ) as { address?: string } | undefined;

  return linked?.address ?? '';
};

/** `2026-09-25` en pantalla, en el idioma de quien la está mirando. */
const formatRegistrationDate = (createdAt: Date): string => {
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) return SIN_NOMBRE;

  try {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(createdAt);
  } catch {
    return createdAt.toISOString().slice(0, 10);
  }
};

/**
 * Deriva el perfil de la app desde el usuario autenticado de Privy.
 *
 * Los campos que las tres vistas necesitan y Privy no tiene se rellenan con
 * valores honestos, nunca con datos falsos:
 *
 * - `telefono`: el número de Privy si está vinculado; si no, la frase
 *   "No informado". La puerta no pide teléfono, así que casi siempre va a ser
 *   esa frase, y está bien: es la verdad.
 * - `faceIdLinked`: `false`. La passkey quedó fuera de la puerta y **no se
 *   consulta** que exista; afirmar lo contrario sería mostrar un estado que
 *   nadie comprobó.
 * - `registradoEn`: la fecha de creación de la cuenta en Privy, que es lo más
 *   cercano a "registro" que existe acá.
 */
export const deriveProfileFromPrivy = (user: User): UserProfileData => {
  const correo = readEmail(user);
  const nombreReal = readRealName(user);

  return {
    nombre: nombreReal ?? (correo ? readableNameFromEmail(correo) : SIN_NOMBRE),
    correo,
    telefono: user.phone?.number ?? 'No informado',
    faceIdLinked: false,
    registradoEn: formatRegistrationDate(user.createdAt),
  };
};