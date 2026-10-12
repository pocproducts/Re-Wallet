/**
 * LA URL DE UNA LLAMADA AL BACKEND.
 *
 * ── El bug que este archivo existe para que no vuelva ───────────────────────
 *
 * El envío de plata no se podía firmar en ninguna red, y la pantalla decía "no
 * pudimos revisar la política de seguridad". El motivo real estaba en el log del
 * Worker: las llamadas llegaban a `/api/api/wallet/policy/evaluate`, porque la
 * base ya traía `/api` y la ruta también. Un 404 que ninguna pantalla podía
 * explicar.
 *
 * ── Por qué se prueba la función pura y no el `fetch` ───────────────────────
 *
 * Porque `API_BASE_URL` se hornea en el build: en una corrida de tests vale lo
 * que valga el entorno, y el caso que rompió producción (`base = '/api'`) no se
 * puede reproducir por env. La regla que importa es la del pegado de los dos
 * pedazos, y eso es una función con dos argumentos.
 */
import { describe, expect, it } from 'vitest';

import { apiUrlWith } from '../../src/services/api';

describe('apiUrlWith', () => {
  it('con la base en /api y una ruta con /api, el prefijo queda una sola vez', () => {
    // El caso de producción: el 404 que dejaba el envío sin firma.
    expect(apiUrlWith('/api', '/api/wallet/policy/evaluate')).toBe('/api/wallet/policy/evaluate');
    expect(apiUrlWith('/api', '/api/wallet/swap/quote')).toBe('/api/wallet/swap/quote');
  });

  it('una ruta sin el prefijo se pega tal cual', () => {
    // La convención de los otros veinte servicios.
    expect(apiUrlWith('/api', '/deposit-info')).toBe('/api/deposit-info');
    expect(apiUrlWith('/api', '/auth/session')).toBe('/api/auth/session');
  });

  it('con la base vacía —mismo origen— la ruta manda', () => {
    expect(apiUrlWith('', '/api/wallet/policy/evaluate')).toBe('/api/wallet/policy/evaluate');
    expect(apiUrlWith('', '/deposit-info')).toBe('/deposit-info');
  });

  it('no toca una ruta que sólo se parece', () => {
    // `/apiary` no es `/api`: colapsar por prefijo y no por segmento rompería
    // una ruta legítima.
    expect(apiUrlWith('/api', '/apiary/thing')).toBe('/api/apiary/thing');
    expect(apiUrlWith('', '/api/apicultura')).toBe('/api/apicultura');
  });
});
