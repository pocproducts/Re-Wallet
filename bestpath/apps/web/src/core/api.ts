/**
 * THE MOCK BOUNDARY IS GONE.
 *
 * This file used to be `BP.api`: `addMoney`, `sendMoney`, `accrueYield`,
 * `createPaymentRequest` and `checkTag`. Every one of them answered with
 * invented data and no request, and four of them ended up wired to a button.
 *
 * What they did, in a wallet app:
 *
 *   - `accrueYield` returned a random number and the home screen ADDED it to
 *     the balance every nine seconds, with a matching invented movement.
 *   - `addMoney` returned `{ ok: true, amount }` and the deposit screen raised
 *     the balance, so pressing "Recibir" printed money.
 *   - `sendMoney` did the same downward, so pressing "Enviar" lowered it.
 *   - `createPaymentRequest` returned a shareable URL on a domain that is not
 *     ours, for a route that does not exist.
 *   - `checkTag` slept 180ms and answered from a hardcoded set of five strings,
 *     so the onboarding screen showed a real-looking availability verdict that
 *     came from a demo.
 *
 * The reads were never here either: they live in `wire/wallet.ts`, which is the
 * real boundary. So there is nothing left for this file to be.
 *
 * The file stays, empty, because `BP.api` is part of the public shape every test
 * imports and deleting the export would be churn to prove a point. What matters
 * is that `BP.api.addMoney` and friends are now `undefined`: the next person
 * wiring a button gets a `TypeError` in the first minute instead of a feature
 * that quietly lies.
 */
import { BP } from './bp';

/* ---- api ---- */
export const Api = BP.api = {};
