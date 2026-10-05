/**
 * EL ESCÁNER: una pantalla, una cámara y una decisión.
 *
 * ── Por qué acá se lee el QR y no en la pantalla de envío ────────────────────
 *
 * Porque leer el código es una tarea con su propio ritmo y su propio error —hay
 * que esperar la cámara, puede estar tapada, puede no abrir— y mezclarla con el
 * formulario de envío mete ese error en un campo que la persona ya está
 * escribiendo. Acá la cámara pasa, el QR se lee, y lo que sale es una dirección
 * o una frase. El formulario recibe lo primero; lo segundo se queda en esta
 * pantalla, donde hay espacio para explicar.
 *
 * ── Por qué el componente devuelve la dirección y no un evento ───────────────
 *
 * Porque el texto crudo que sale de un QR no es nada: es lo que dice una
 * pantalla que puede haber en la mesa de cualquiera. Este componente no lo
 * reenvía: decide con `judgeScannedValue` y **sólo** entrega una dirección que
 * pasó la misma validación que la que se pega a mano. Quien está del otro lado
 * —`App.tsx`, el flujo de envío— recibe o un destino o nada.
 *
 * ── Por qué cancelar no toca nada ────────────────────────────────────────────
 *
 * Un escáner se cancela, se tilda y se cierra sin querer, y las tres cosas
 * tienen que devolver a la persona exactamente donde estaba. El componente
 * llama a `onClose()` y no llama a `onScanSuccess()`, que es lo único que escribe
 * en la pantalla de atrás. Ni el monto, ni el paso del flujo, ni el texto del
 * campo se tocan: no hay estado propio que sincronizar porque lo único que este
 * componente sabe del formulario es la dirección que le delivered.
 *
 * ── Por qué el video es `<video>` y no un `img` con `capture` ────────────────
 *
 * Porque `<img capture>` no abre un visor: abre la cámara de fotos del sistema y
 * vuelve con **una** foto cuando la persona decide. Para leer un QR eso es
 * aceptable en un formulario, pero acá el caso real es "la otra persona me
 * muestra su pantalla": hay que ver el visor y decidir en el momento.
 */
import React, { useCallback, useState } from 'react';
import { QrCode, X, Zap, ZapOff, CameraOff, RotateCcw } from 'lucide-react';

import { useQrScanner } from '../../hooks/useQrScanner';
import { CAMERA_STATUS_TEXT, SCAN_FRAME_NOTE, judgeScannedValue } from '../../config/qrScan';
import type { SendChainView } from '../../config/send';

interface QrScannerModalProps {
  /** `true` sólo mientras está abierto. Es lo único que enciende la cámara. */
  isOpen: boolean;
  /** Cerrar o cancelar. Nunca escribe en la pantalla de atrás. */
  onClose: () => void;
  /**
   * Salió un destino válido.
   *
   * Recibe la dirección ya validada para la red en juego, recortada y sin más.
   */
  onScanSuccess?: (address: string) => void;
  /**
   * La red del envío, o `null` si el escáner se abrió sin una.
   *
   * Es lo que permite decir *"esa dirección es de otra red"* en vez de dejar que
   * un `0x…` llegue a un envío por Solana. Cuando viene `null` —el escáner de la
   * cabecera— no se puede afirmar la red y sólo se valida la forma.
   */
  chain?: SendChainView | null;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
  chain = null,
}) => {
  /** El rechazo que se está mostrando, o `null` si el QR no dio uno. */
  const [rejection, setRejection] = useState<string | null>(null);
  /** Cuántos intentos lleva: el visor usa el aviso "probá otra vez". */
  const [attempts, setAttempts] = useState(0);

  const onDecoded = useCallback(
    (text: string) => {
      const verdict = judgeScannedValue(text, chain);

      if (!verdict.ok) {
        // No se muestra el valor: se muestra qué se detectó y qué hacer. Ver la
        // nota de `config/qrScan.ts`.
        setRejection(verdict.message);
        setAttempts((value) => value + 1);
        return;
      }

      setRejection(null);
      onScanSuccess?.(verdict.address);
    },
    [chain, onScanSuccess],
  );

  const scanner = useQrScanner(isOpen, onDecoded);

  /* Cerrado: no se monta nada y, sobre todo, no hay cámara. */
  if (!isOpen) return null;

  const cameraMissing = scanner.status === 'denied' || scanner.status === 'unavailable' || scanner.status === 'insecure';
  const expectedNote =
    chain === null ? 'Apuntá al QR de la otra billetera.' : `Apuntá al QR de cobro en ${chain.label}.`;

  return (
    <div className="absolute inset-0 z-[60] bg-[#0d0d0f] text-white flex flex-col justify-between safe-top-0 safe-bottom-0 select-none animate-in fade-in duration-200 overflow-hidden font-sans w-full max-w-md mx-auto">
      {/* ═══ CABECERA: cerrar, qué es esto, linterna ═══════════════════════════ */}
      <div className="p-4 pt-5 flex items-center justify-between shrink-0 z-20 bg-gradient-to-b from-black/80 to-transparent">
        <button
          onClick={onClose}
          type="button"
          aria-label="Cerrar escáner"
          className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white backdrop-blur-md transition-all cursor-pointer"
        >
          <X className="w-5 h-5 stroke-[2.2]" />
        </button>

        <h1 className="text-sm font-extrabold font-display tracking-tight text-white flex items-center gap-1.5">
          <QrCode className="w-4 h-4 text-[#ccff00]" />
          <span>Escanear código QR</span>
        </h1>

        {scanner.torchSupported ? (
          <button
            onClick={scanner.toggleTorch}
            type="button"
            aria-label={scanner.torchOn ? 'Apagar la linterna' : 'Prender la linterna'}
            className={`w-11 h-11 rounded-full backdrop-blur-md flex items-center justify-center transition-all cursor-pointer ${
              scanner.torchOn ? 'bg-[#ccff00] text-black shadow-md' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            {scanner.torchOn ? <Zap className="w-5 h-5 fill-current stroke-[2]" /> : <ZapOff className="w-5 h-5 stroke-[2]" />}
          </button>
        ) : (
          <div className="w-11" />
        )}
      </div>

      {/* ═══ VISOR ════════════════════════════════════════════════════════════ */}
      <div className="flex-1 relative flex flex-col items-center justify-center p-6 overflow-hidden">
        {/*
          El `<video>` está siempre en el DOM mientras el escáner está abierto,
          también cuando la cámara no se pudo abrir: el hook lo necesita montado
          para colgarle el stream, y sacarlo del árbol en el caso de error
          cambiaría el orden en que se corren los efectos.
        */}
        <video
          ref={scanner.videoRef}
          playsInline
          muted
          aria-label="Vista de la cámara"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            scanner.status === 'scanning' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Fondo del visor cuando no hay imagen: la grilla, no un video falso. */}
        {scanner.status !== 'scanning' && (
          <div className="absolute inset-0 bg-[#0d0d0f] flex flex-col items-center justify-center p-6 text-center">
            <div className="w-full h-full absolute inset-0 opacity-20 bg-[radial-gradient(#ccff00_1px,transparent_1px)] [background-size:16px_16px]" />
          </div>
        )}

        <div
          className={`relative z-10 w-64 h-64 sm:w-72 sm:h-72 rounded-3xl border-2 p-2 flex items-center justify-center transition-colors ${
            scanner.status === 'scanning' ? 'border-white/20' : 'border-white/10'
          }`}
        >
          <div className="absolute -top-1 -left-1 w-7 h-7 border-t-4 border-l-4 border-[#ccff00] rounded-tl-xl" />
          <div className="absolute -top-1 -right-1 w-7 h-7 border-t-4 border-r-4 border-[#ccff00] rounded-tr-xl" />
          <div className="absolute -bottom-1 -left-1 w-7 h-7 border-b-4 border-l-4 border-[#ccff00] rounded-bl-xl" />
          <div className="absolute -bottom-1 -right-1 w-7 h-7 border-b-4 border-r-4 border-[#ccff00] rounded-br-xl" />

          {/* La línea sólo late mientras se está leyendo: un laser sobre una
              pantalla en negro sería una promesa de algo que no está pasando. */}
          {scanner.status === 'scanning' && (
            <div className="absolute inset-x-3 h-0.5 bg-[#ccff00] shadow-[0_0_15px_#ccff00] animate-bounce" />
          )}

          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/30 backdrop-blur-xs">
            <QrCode className="w-8 h-8 stroke-[1.5]" />
          </div>
        </div>

        {/*
          Sin cámara, la instrucción de apuntar no sirve de nada: se cambia por lo
          que hay que hacer. Y es una frase, no un error: el permiso denegado es
          una decisión de la persona.
        */}
        <p className="relative z-10 text-xs font-semibold text-slate-300 mt-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-center max-w-[90%]">
          {cameraMissing ? 'Sin cámara no hay escaneo.' : expectedNote}
        </p>
      </div>

      {/* ═══ PIE: lo que pasó ═════════════════════════════════════════════════ */}
      <div className="p-4 pb-6 space-y-3 shrink-0 z-20 bg-gradient-to-t from-black via-black/90 to-transparent">
        {/*
          La cámara que no abrió.

          El botón grande es *reintentar*, no algo que suene a reparación: negarle
          la cámara es una decisión de la persona y se la puede cambiar, pero la
          app no la cambia por ella. Y la última línea ofrece el camino que
          siempre funciona —pegar— para que nadie quede encerrado en un error.
        */}
        {cameraMissing && (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-4 space-y-3 animate-in slide-in-from-bottom-2">
            <div className="flex items-start gap-3">
              <CameraOff className="w-5 h-5 text-[#ccff00] shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-white/90 leading-relaxed">
                {CAMERA_STATUS_TEXT[scanner.status]}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={scanner.retry}
                type="button"
                className="flex-1 py-3 bg-[#ccff00] hover:bg-[#b8e600] text-black font-extrabold text-xs rounded-2xl active:scale-95 transition-all cursor-pointer"
              >
                Probar de nuevo
              </button>
              <button
                onClick={onClose}
                type="button"
                className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs rounded-2xl active:scale-95 transition-all cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Un QR que no era un destino. La frase ya dice qué hacer. */}
        {rejection !== null && (
          <div className="bg-white rounded-3xl p-5 text-black shadow-2xl animate-in slide-in-from-bottom-3 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                <RotateCcw className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div className="flex-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase block">Ese QR no sirve</span>
                <span className="text-base font-black font-display text-black block tracking-tight leading-snug">
                  {rejection}
                </span>
              </div>
            </div>

            {/*
              Cancelar desde acá es lo mismo que cerrar con la X: no se entrega
              nada, y la pantalla de atrás queda exactamente como estaba.
            */}
            <button
              onClick={onClose}
              type="button"
              className="w-full py-3.5 bg-[#ccff00] hover:bg-[#b8e600] text-black font-extrabold text-xs rounded-2xl active:scale-95 transition-all shadow-sm cursor-pointer"
            >
              Volver al envío
            </button>
          </div>
        )}

        {/*
          La promesa del contrato, escrita donde se abre la cámara.

          No es un aviso legal: es la razón por la que el botón existe y por la
          que se puede dejar el teléfono en la mesa sin pensarlo.
        */}
        <p className="text-[10px] font-medium text-slate-500 text-center leading-snug px-2">
          {SCAN_FRAME_NOTE}
          {attempts > 0 ? ' Probá con más luz o más cerca.' : ''}
        </p>
      </div>
    </div>
  );
};