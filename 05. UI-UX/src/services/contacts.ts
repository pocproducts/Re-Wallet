/**
 * La agenda de ReWALLET: a quién le mandaste plata por su tag.
 *
 * Sale del servidor y de ninguna otra fuente. Antes esta pantalla tenía cinco
 * contactos escritos a mano —con nombres y tags reales— y tocar una fila mandaba
 * el envío a una persona de verdad: una lista que no viene de tus envíos es una
 * lista de destinos, no una agenda.
 */
import { getJson } from './api';

export interface RewalletContact {
  readonly tag: string;
  /** El nombre de perfil, si esa persona lo tiene. */
  readonly name: string | null;
  readonly lastSentAt: string;
  readonly sends: number;
}

export interface ContactsView {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly contacts: readonly RewalletContact[];
}

export const EMPTY_CONTACTS: ContactsView = { status: 'idle', contacts: [] };

export const readContacts = async (): Promise<ContactsView> => {
  const body = await getJson<{ contacts: RewalletContact[] }>('/contacts');
  return { status: 'ready', contacts: body.contacts };
};
