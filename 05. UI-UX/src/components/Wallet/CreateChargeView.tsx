/**
 * CREAR UN COBRO: primero en qué se cobra, después cuánto, y el link para compartir.
 *
 * ── Por qué son DOS pantallas y no una ──────────────────────────────────────
 *
 * Antes esta pantalla hacía las dos preguntas en el mismo scroll: la fila de
 * chips Monad / USDC / Solana —más las redes de USDC— arriba, y el importe con su
 * teclado abajo, con la nota en el medio. Todo visible a la vez.
 *
 * El resultado era que elegir la moneda **dejaba de leerse como una decisión** y
 * pasaba a parecer un campo más del formulario: con un importe gigante y un
 * teclado numérico dominating la pantalla, los tres logos parecían una opción
 * más. Y no lo son. Un cobro en USDC-Solana y uno en MON-Monad no son el mismo
 * cobro: no pagan los mismos topes y quien los paga ve cosas distintas.
 *
 * El flujo ahora es tres pasos, y el primero no tiene nada más:
 *
 * ```
 * [1] En qué querés cobrar   ← sola, fondo lima, un botón: Confirmar
 * [2] Importe a cobrar       ← la elección ya está decidida, no se vuelve a preguntar
 * [3] Cobro generado         ← el QR y el link (sin cambios)
 * ```
 *
 * El paso [2] **no repite la elección**, y eso es deliberado: preguntarla dos
 * veces es exactamente la mezcla que había que deshacer. Y como no se avanza sin
 * `canConfirmCharge`, en [2] siempre hay un símbolo detrás del importe — nunca
 * un "?" esperando que alguien se acuerde de elegir.
 *
 * ── Qué es esta pantalla y qué no es ─────────────────────────────────────────
 *
 * Es el otro camino de la misma puerta que el QR: `contrato-dinero.md` dice que
 * el dinero entra *"por un link compartido"* o *"por QR"*, y este es el primero.
 * La diferencia con el modal de cobrar por QR es que acá **no hay una dirección**
 * —no se muestra, no se copia, no existe para la app—: hay un link, y el link es
 * un identificador de 32 caracteres que el servidor drew al azar.
 *
 * Las reglas de *qué* se puede cobrar —qué familias salen del catálogo, cuándo
 * hay que preguntar la red, cuándo se puede avanzar— no viven acá: están en
 * `services/chargeAssetChoice`, que es donde se pueden testear sin una pantalla.
 * ── Por qué el link y no un QR ───────────────────────────────────────────────
 *
 * Porque un QR con la dirección de esta persona la muestra. Un QR con el link no:
 * lo que viaja es un id, y ese id no se puede usar para robar nada salvo que ya
 * tengas el link. El QR de dirección sigue existiendo en el modal de cobrar y es
 * otra pantalla; esta no lo reemplaza, lo acompaña.
 *
 * ── Por qué el importe es un texto y no un número ────────────────────────────
 *
 * Porque lo que se manda es `numeric(20,6)` y va como cadena. `chargeAmountToDecimal`
 * hace la cuenta con enteros: el punto del teclado es separador de miles, la coma
 * es el decimal, y los decimales de más se recortan en vez de redondearse. Un
 * `parseFloat` acá mandaría plata que nadie escribió.
 *
 * ── Por qué no hay "cancelar" ────────────────────────────────────────────────
 *
 * Porque `status = 'cancelled'` existe en la tabla pero esta tarea no lo escribe:
 * un cobro que nadie pagó no tiene plata que devolver, así que cancelarlo no le
 * devuelve nada a nadie —lo libera, y con 24 horas de plazo eso ya pasa solo—. Es
 * una decisión de producto, no un olvido, y está anotada en el README del backend.
 *
 * ── Por qué el confeti es el único festejo de acá ────────────────────────────
 *
 * Porque es lo único que pasó: se creó un link. No se movió plata, no se pagó
 * nada, y la pantalla de resultado no dice "cobraste": dice "cobro generado". El
 * festejo tiene que describir el hecho y nada más.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Share2, X } from 'lucide-react';
import confetti from 'canvas-confetti';

import { NumericKeypad } from '../common';
import {
  CHARGE_FAILURE_TEXT,
  chargeAssetOptions,
  chargeAmountToDecimal,
  chargeChainLabel,
  formatChargeAmount,
  createPaymentRequest,
  type PaymentRequest,
} from '../../services/paymentRequests';
import {
  canConfirmCharge,
  chargeChoiceLabel,
  chargeFamilies,
  resolveChargeChoice,
} from '../../services/chargeAssetChoice';
import { useDepositInfo } from '../../hooks/useDepositInfo';
import { identityOf } from '../../services/portfolioIdentity';
import { paymentRequestShareUrl } from '../../config/paymentLinks';
import { AssetIcon } from '../common/AssetIcon';
import { QrCode } from '../common/QrCode';

interface CreateChargeViewProps {
  onClose: () => void;
  /**
   * El origen donde la persona está, para armar el link.
   *
   * Lo pasa el `App` en vez de leerlo acá: esta pantalla no sabe de dónde vino la
   * app, y el único que lo sabe es el que la montó. Sin un origen real el link
   * sería un texto que no abre nada.
   */
  origin: string;
}

/**
 * Los tres pasos, en orden. `asset` es el nuevo primero.
 *
 * El estado empieza en `asset` y no en `amount`: entrar a la pantalla ya es
 * estar en la pregunta de qué cobrar, porque esa es la primera decisión del
 * flujo. `amount` es inalcanzable sin una elección confirmada, y eso lo garantiza
 * `canConfirmCharge`, no el orden en que se escribieron los `if`.
 */
type Step = 'asset' | 'amount' | 'created';

export const CreateChargeView: React.FC<CreateChargeViewProps> = ({ onClose, origin }) => {
  const [step, setStep] = useState<Step>('asset');
  const [amount, setAmount] = useState('0');
  const [note, setNote] = useState('');
  const [charge, setCharge] = useState<PaymentRequest | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [creating, setCreating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  /** La familia elegida —`MON`, `USDC` o `SOL`— o `null` si todavía no eligió. */
  const [familyId, setFamilyId] = useState<string | null>(null);
  /**
   * La red elegida cuando la familia es USDC, que vive en varias.
   *
   * `null` significa "todavía no toqué ninguna", y no "no hay": la red efectiva la
   * deriva `resolveChargeChoice` desde el catálogo, así que un USDC recién
   * elegido ya tiene una red y el botón Confirmar no queda colgado esperando un
   * toque que nadie pediría.
   */
  const [usdcChain, setUsdcChain] = useState<string | null>(null);

  /*
   * LA LISTA SALE DEL CATÁLOGO, no de esta pantalla.
   *
   * `useDepositInfo` es el mismo `GET /api/deposit-info` que usan el depósito y
   * el envío. Un cobro que dice "10" sin decir en qué se cobraría obliga a quien
   * paga a interpretarlo, así que acá se elige la cadena y el activo antes de
   * teclear, y el backend recibe los dos. No hay tickers escritos a mano: si el
   * catálogo no llegó, no hay selector, y se dice.
   */
  const depositInfo = useDepositInfo(true);
  const assetOptions = chargeAssetOptions(depositInfo.networks);

  /*
   * LAS TRES FAMILIAS DE LA FILA y la elección concreta salen del servicio, no de
   * esta pantalla.
   *
   * Que estén en `chargeAssetChoice` no es purismo: la regla de que **no se pasa
   * al importe sin elección confirmada** es una regla de datos, y escrita acá
   * sería un `disabled` que el próximo que edite el archivo relaja sin notar lo
   * que rompe. En el servicio está testeada y sobrevive al refactor.
   */
  const families = useMemo(() => chargeFamilies(assetOptions), [assetOptions]);

  /** Las redes donde el catálogo tiene USDC, en su orden. */
  const usdcNetworks = useMemo(
    () => families.find((family) => family.id === 'USDC')?.options ?? [],
    [families],
  );

  /** La opción que describe la elección: símbolo y red, o `null` si no hay nada elegido. */
  const chosen = useMemo(
    () => resolveChargeChoice(families, familyId, usdcChain),
    [families, familyId, usdcChain],
  );

  /** El logo del activo elegido, para el recordatorio de la pantalla [2]. */
  const chosenIdentity = useMemo(
    () => (chosen === null ? null : identityOf(chosen.symbol)),
    [chosen],
  );

  const shareUrl = useMemo(
    () => (charge === null ? null : paymentRequestShareUrl(charge.id, origin)),
    [charge, origin],
  );

  /*
   * El QR de **ese** link, no de otra cosa.
   *
   * El link y el QR son el mismo cobro: el id es del backend, el link se arma
   * acá y el código dibuja ese mismo texto. Que el QR esté en esta pantalla
   * también es lo que hace que las dos presentaciones sean la misma —una
   * persona puede mostrar el código o mandar el link y quien recibe llega igual
   * a `PayChargeView` con el mismo cobro—.
   */
  

  const onKeyPress = useCallback((key: string) => {
    setAmount((current) => {
      if (key === 'backspace') return current.length <= 1 ? '0' : current.slice(0, -1);
      if (key === ',') return current.includes(',') ? current : `${current},`;
      if (current === '0') return key;
      // Once coma, los decimales se cuentan: un importe no es un número sin fin.
      if (current.includes(',') && current.split(',')[1].length >= 6) return current;
      return current.length < 12 ? `${current}${key}` : current;
    });
  }, []);

  const create = useCallback(async () => {
    if (creating) return;
    // Sin cadena y activo no se crea: el botón queda deshabilitado y esta es la
    // segunda línea.
    if (chosen === null) return;

    let decimal: string;
    try {
      decimal = chargeAmountToDecimal(amount);
    } catch {
      setFailureCode('AMOUNT_INVALID');
      return;
    }

    setCreating(true);
    setFailureCode(null);
    try {
      const created = await createPaymentRequest({
        amount: decimal,
        chain: chosen.chain,
        asset: { symbol: chosen.symbol },
        note: note.trim().length === 0 ? null : note.trim(),
      });
      setCharge(created);
      setStep('created');
      confetti({
        particleCount: 45,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#000000', '#ffffff', '#ccff00'],
      });
    } catch (error) {
      setFailureCode((error as { code?: string }).code ?? 'PAYMENT_REQUEST_CREATE_FAILED');
    } finally {
      setCreating(false);
    }
  }, [amount, chosen, creating, note]);

  /*
   * CONFIRMAR: de "en qué querés cobrar" al importe.
   *
   * Tocar un chip elige; este botón avanza. Son gestos distintos a propósito: con
   * un solo gesto, elegir y confirmar se confunden, y se llega al importe sin
   * haber decidido. Volver atrás desde el importe conserva la elección, que es lo
   * que hace que corregir una moneda no cueste rehacer el resto.
   */
  const confirmAsset = useCallback(() => {
    if (!canConfirmCharge(chosen)) return;
    setStep('amount');
  }, [chosen]);

  const copyLink = useCallback(() => {
    if (shareUrl === null) return;
    void navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  /**
   * Lo que comparte: el importe con su activo y su cadena, que es lo que le va
   * a pedir a quien lo abre.
   */
  const shareText = (): string =>
    charge === null
      ? 'Te estoy cobrando'
      : `Te estoy cobrando ${charge.amount} ${charge.asset.symbol}, en ${chargeChainLabel(charge.chain)}`;

  const share = useCallback(() => {
    if (shareUrl === null) return;
    if (typeof navigator.share === 'function') {
      void navigator
        .share({
          title: 'Cobro de ReWALLET',
          text: shareText(),
          url: shareUrl,
        })
        .catch(() => {
          /* Quien cancela el compartir no necesita un error en pantalla. */
        });
      return;
    }
    // Sin `navigator.share` —un escritorio viejo, un navegador sin soporte— el
    // compartir es copiar, y se dice lo mismo en vez de no hacer nada.
    copyLink();
  }, [charge, copyLink, shareUrl]);

  const close = useCallback(() => {
    setStep('asset');
    setAmount('0');
    setNote('');
    setCharge(null);
    setFailureCode(null);
    setCopied(false);
    setFamilyId(null);
    setUsdcChain(null);
    onClose();
  }, [onClose]);

  /* ═══ [1] EN QUÉ QUERÉS COBRAR ═══════════════════════════════════════════════ */
  /*
   * La primera pantalla del flujo, y la única que tiene la pregunta.
   *
   * Está sola a propósito: sin importe, sin teclado, sin nota. Antes esta misma
   * fila de chips convivía con un número gigante y un teclado numérico, y con
   * todo eso en pantalla elegir la moneda se leía como un campo más del
   * formulario en vez de como la decisión que es.
   *
   * El logo lo pone `AssetIcon`, que cae al glifo si no hay archivo.
   */
  if (step === 'asset') {
    return (
      <div className="flex-1 w-full h-full bg-[#ccff00] text-black flex flex-col overflow-y-auto font-sans">
        <div className="flex items-center justify-between shrink-0 p-5 pt-6">
          <div className="w-11" />
          <h2 className="text-base font-black font-display uppercase tracking-wider">Cobrar</h2>
          <button
            onClick={close}
            type="button"
            aria-label="Cerrar"
            className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5 max-w-sm mx-auto w-full">
          <div className="text-center space-y-1">
            <h3 className="text-2xl font-black font-display uppercase tracking-tight leading-tight">
              ¿En qué querés cobrar?
            </h3>
            <p className="text-[11px] font-bold text-black/55 leading-snug">
              Es la primera decisión: define quién te puede pagar y en qué red.
            </p>
          </div>

          {/* Cargando: se dice que se está leyendo, y no se habilita nada. */}
          {depositInfo.status !== 'ready' && (
            <div className="w-full rounded-2xl bg-black/5 border border-black/10 px-3 py-2.5 text-center">
              <p className="text-[11px] font-bold text-black/70 leading-snug">
                {depositInfo.status === 'error'
                  ? 'No pudimos ver en qué monedas podés cobrar.'
                  : 'Estamos viendo en qué monedas podés cobrar…'}
              </p>
              {depositInfo.status === 'error' && (
                <button
                  type="button"
                  onClick={depositInfo.reload}
                  className="mt-1.5 text-[11px] font-black uppercase tracking-wider text-black underline active:opacity-60 cursor-pointer"
                >
                  Probar de nuevo
                </button>
              )}
            </div>
          )}

          {depositInfo.status === 'ready' && assetOptions.length === 0 && (
            <p className="w-full rounded-2xl bg-black/5 border border-black/10 px-3 py-2.5 text-[11px] font-bold text-black/70 text-center leading-snug">
              Todavía no hay ninguna moneda para cobrar.
            </p>
          )}

          {/*
            LA FILA: Monad, USDC, Solana. Tres tarjetas, no una lista.
            Antes la pantalla ofrecía siete pares (cadena, símbolo) y obligaba a
            scrollear para encontrar el de siempre. Las tres son las tres familias
            que el producto muestra, en el orden que se piden, y la del medio es
            la única que vive en varias redes.
          */}
          {families.length > 0 && (
            <div className="w-full grid grid-cols-3 gap-2.5">
              {families.map((candidate) => {
                const identity = identityOf(candidate.symbol);
                const active = candidate.id === familyId;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setFamilyId(candidate.id)}
                    aria-pressed={active}
                    className={`flex flex-col items-center gap-1.5 rounded-3xl px-2 py-4 transition-all active:scale-[0.98] cursor-pointer border-2 ${
                      active
                        ? 'bg-black text-[#ccff00] border-black'
                        : 'bg-white text-black border-black/10'
                    }`}
                  >
                    <AssetIcon
                      ticker={candidate.symbol}
                      glyph={identity?.glyph ?? candidate.symbol.slice(0, 1)}
                      iconBg={identity?.iconBg ?? 'bg-slate-300'}
                      sizeClass="w-11 h-11"
                      glyphClass={active ? 'text-[#ccff00]' : 'text-base'}
                    />
                    <span className="text-base font-black font-display leading-none">
                      {candidate.symbol}
                    </span>
                    <span
                      className={`text-[10px] font-bold leading-none text-center ${
                        active ? 'text-[#ccff00]/75' : 'text-black/50'
                      }`}
                    >
                      {candidate.id === 'USDC'
                        ? `${candidate.options.length} redes`
                        : `en ${candidate.options[0]?.chainLabel ?? ''}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/*
            USDC Y SUS REDES: la familia del medio es la única que no tiene una
            red sola. Se dice en cuáles está —todas las del catálogo, que son "las
            que tenemos"— y se elige en cuál se cobra, porque el cobro viaja con
            UNA cadena: quien lo abre paga en esa y en ninguna otra.

            Está acá y no en la pantalla del importe a propósito: la red ES parte de
            "en qué querés cobrar". Moverla después reintroduce la mezcla que este
            flujo deshace.

            Con una sola red no se pregunta: no hay nada que elegir.
          */}
          {familyId === 'USDC' && usdcNetworks.length > 1 && (
            <div className="w-full space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-black/50 font-display block text-center">
                En qué red lo cobrás
              </span>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {usdcNetworks.map((option) => {
                  const active = option.chain === chosen?.chain;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setUsdcChain(option.chain)}
                      aria-pressed={active}
                      className={`rounded-full px-3.5 py-2 text-[11px] font-bold border transition-all active:scale-95 cursor-pointer ${
                        active
                          ? 'bg-black text-[#ccff00] border-black'
                          : 'bg-white text-black border-black/10'
                      }`}
                    >
                      {option.chainLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/*
          EL BOTÓN DE AVANZAR, y lo único que hay abajo.

          Deshabilitado hasta que haya una elección con símbolo y red, porque
          después no se puede corregir sin volver atrás. El texto de abajo dice
          exactamente qué se está por confirmar, para que nadie confirme a ciegas.
        */}
        <div className="px-5 pb-6 max-w-sm mx-auto w-full shrink-0 space-y-3">
          <button
            type="button"
            onClick={confirmAsset}
            disabled={!canConfirmCharge(chosen)}
            className="w-full py-4 rounded-2xl bg-black text-[#ccff00] font-extrabold text-sm shadow-xl active:scale-98 transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            Confirmar
          </button>
          <p className="text-[11px] font-semibold text-black/55 text-center leading-snug min-h-[2.5rem]">
            {chosen === null
              ? 'Elegí una de las tres para continuar.'
              : `${chargeChoiceLabel(chosen)}. Después te pido el importe.`}
          </p>
        </div>
      </div>
    );
  }

  /* ═══ [2] IMPORTE ═══════════════════════════════════════════════════════════ */
  if (step === 'amount') {
    return (
      <div className="flex-1 w-full h-full bg-[#ccff00] text-black flex flex-col overflow-y-auto font-sans">
        <div className="flex items-center justify-between shrink-0 p-5 pt-6">
          {/*
            La flecha vuelve a la pantalla [1] con la elección intacta, y no cierra:
            corregir la moneda no debería tirar el importe que ya se tecleó.
          */}
          <button
            onClick={() => setStep('asset')}
            type="button"
            aria-label="Volver a elegir en qué cobrás"
            className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
          </button>
          <h2 className="text-base font-black font-display uppercase tracking-wider">Importe a cobrar</h2>
          <button
            onClick={close}
            type="button"
            aria-label="Cerrar"
            className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
          >
            <X className="w-5 h-5 stroke-[2.5]" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center py-2 space-y-3">
          {/*
            LA ELECCIÓN, YA HECHA. No es un selector: es un recordatorio de lo que
            se confirmó en la pantalla anterior.

            Este es el bloque que se eliminó de acá. La fila de chips Monad / USDC /
            Solana y las redes de USDC convivían con el importe y el teclado en el
            mismo scroll, y con todo eso en pantalla elegir la moneda se leía
            como un campo más del formulario. Ahora la pregunta está en su propia
            pantalla, y acá solo se recuerda la respuesta: el símbolo va junto al
            número porque sin él el importe no significa nada, y el logo sube con
            él para que "10" nunca sea un número suelto.

            Cambiarla es la flecha de arriba, que vuelve a la pantalla [1] con la
            elección intacta — no hace falta rehacer nada para corregir una moneda.
          */}
          <button
            type="button"
            onClick={() => setStep('asset')}
            className="flex items-center gap-2.5 rounded-full bg-black/5 border border-black/10 pl-2 pr-4 py-2 active:scale-95 transition-transform cursor-pointer"
            aria-label="Cambiar en qué cobrás"
          >
            <AssetIcon
              ticker={chosen?.symbol ?? ''}
              glyph={chosenIdentity?.glyph ?? '?'}
              iconBg={chosenIdentity?.iconBg ?? 'bg-slate-300'}
              sizeClass="w-8 h-8"
              glyphClass="text-sm"
            />
            <span className="text-[11px] font-black font-display uppercase tracking-wider">
              {chosen === null ? 'Elegí la moneda' : `${chosen.symbol} · ${chosen.chainLabel}`}
            </span>
            <ArrowLeft className="w-3.5 h-3.5 stroke-[3] rotate-180 opacity-50" />
          </button>

          <span className="text-xs font-black uppercase tracking-widest text-black/60 font-display">
            Importe a cobrar
          </span>
          <div className="flex items-baseline justify-center font-display px-3">
            <span className="text-3xl font-black text-black/40 mr-2">
              {chosen?.symbol ?? ''}
            </span>
            <span className="text-6xl sm:text-7xl font-black text-black tracking-tight">{amount}</span>
          </div>
          <span className="text-[11px] font-bold text-black/55 font-display text-center px-6">
            {chosen === null
              ? 'Volvé atrás y elegí en qué querés cobrar.'
              : chargeChoiceLabel(chosen)}
          </span>
        </div>

        <div className="px-5 pb-5 space-y-4 max-w-sm mx-auto w-full shrink-0">
          {/*
            La nota es opcional y corta a propósito: es lo que quien paga lee antes
            de decidir, y un párrafo no se lee en el momento en que se paga.
          */}
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 280))}
            placeholder="Nota (opcional): ¿es por qué?"
            maxLength={280}
            className="w-full min-h-[48px] bg-black/5 border border-black/10 focus:border-black rounded-2xl px-3.5 text-sm text-black placeholder-black/40 focus:outline-none transition-colors font-medium"
          />

          {failureCode !== null && (
            <p className="text-[11px] font-bold text-black/70 bg-black/10 rounded-xl px-3 py-2 leading-snug">
              {CHARGE_FAILURE_TEXT[failureCode] ?? 'No pudimos crear el cobro.'}
            </p>
          )}

          <NumericKeypad onKeyPress={onKeyPress} />

          <button
            type="button"
            onClick={() => void create()}
            disabled={amount === '0' || chosen === null || creating}
            className="w-full py-4 rounded-2xl bg-black text-[#ccff00] font-extrabold text-sm shadow-xl active:scale-98 transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            {creating ? 'Creando el link…' : 'Generar link de cobro'}
          </button>

          <p className="text-[11px] font-semibold text-black/55 text-center leading-snug">
            El link vence en 24 horas y se puede pagar una sola vez. Quien lo abra ve
            el importe y tu nombre, nunca una dirección.
          </p>
        </div>
      </div>
    );
  }

  /* ═══ LINK CREADO ═══════════════════════════════════════════════════════════ */
  return (
    <div className="flex-1 w-full h-full bg-[#ccff00] text-black flex flex-col overflow-y-auto font-sans">
      <div className="flex items-center justify-between shrink-0 p-5 pt-6">
        <div className="w-11" />
        <h2 className="text-base font-black font-display uppercase tracking-wider">Cobro generado</h2>
        <button
          onClick={close}
          type="button"
          aria-label="Cerrar"
          className="w-11 h-11 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
        >
          <X className="w-5 h-5 stroke-[2.5]" />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 max-w-sm mx-auto w-full text-center">
        <span className="text-5xl font-black font-display tracking-tight">
          {formatChargeAmount(charge?.amount ?? amount)} {charge?.asset.symbol ?? chosen?.symbol ?? ''}
        </span>
        <span className="text-[11px] font-black uppercase tracking-widest text-black/55 font-display">
          {charge === null ? 'Cobro generado' : `en ${chargeChainLabel(charge.chain)}`}
        </span>
        {charge?.note ? (
          <span className="text-xs font-semibold text-black/60 leading-snug">{charge.note}</span>
        ) : null}

        {/*
          El QR del link, y el link.

          Los dos están porque son la misma fila de `payment_requests` mostrada de
          dos maneras. Si el link llegara a no entrar en un QR, no se dibuja un
          código inventado en su lugar: no se dibuja, se dice abajo y el link
          queda —que es lo mismo y siempre funciona—.

          El marco lo mide `QrCode`: antes el `viewBox` declaraba `size + 2`
          sobre un path que ocupa `size + 8`, y el código salía cortado contra
          el borde. Los dos módulos de margen que faltaban los tapaba el fondo
          blanco, que es justo lo que hace que un error de marco pase
          desapercibido.
        */}
        {shareUrl !== null && (
          <QrCode
            value={shareUrl}
            label="Código QR del cobro"
            size={240}
            fallback="No pudimos dibujar el código. El link de abajo sirve igual: es el mismo cobro."
          />
        )}

        {/*
          El link, y sólo el link.

          Es lo que se comparte y lo que se abre: un identificador de 32 caracteres
          que el servidor no puede adivinar. No hay una dirección en esta pantalla
          porque no hay una dirección en este producto — quien cobra no la expone y
          quien paga no la necesita—.
        */}
        <div className="w-full bg-white rounded-[28px] p-4 shadow-xl border-2 border-black/10 space-y-2">
          <span className="text-[11px] font-black uppercase tracking-wider text-black/45 block">
            Link para cobrar
          </span>
          <p className="text-[11px] font-mono font-bold text-black/80 break-all leading-snug">
            {shareUrl}
          </p>
        </div>

        <div className="w-full grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={share}
            className="py-4 bg-black text-white font-extrabold text-sm rounded-2xl active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
          >
            <Share2 className="w-4 h-4 stroke-[2.2]" />
            <span>Compartir</span>
          </button>
          <button
            type="button"
            onClick={copyLink}
            className="py-4 bg-white text-black font-extrabold text-sm rounded-2xl active:scale-95 transition-all shadow-sm flex items-center justify-center gap-2 border border-black/10 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
                <span>Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 stroke-[2.2]" />
                <span>Copiar link</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="px-5 pb-6 max-w-sm mx-auto w-full shrink-0">
        <button
          type="button"
          onClick={close}
          className="w-full py-4 rounded-2xl bg-black/10 text-black font-extrabold text-sm active:scale-95 transition-all cursor-pointer"
        >
          Listo
        </button>
      </div>
    </div>
  );
};
