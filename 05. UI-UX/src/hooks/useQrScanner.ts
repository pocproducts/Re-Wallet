/**
 * LA CÁMARA DEL ESCÁNER: se pide al abrir, se suelta al cerrar, y no se suplica.
 *
 * ── Por qué la cámara vive en un hook y no en la pantalla ────────────────────
 *
 * Porque el requisito no es un requisito de esta pantalla: es que **nadie** pide
 * la cámara antes de que alguien la abra. Un `getUserMedia` en el arranque de la
 * app —incluso en un `useEffect` que después se cierre— hace que el navegador
 * muestre el candado de permiso al entrar, y a partir de ahí la pregunta ya
 * está gastada: la persona responde a algo que no pidió y a la segunda pantalla
 * que lo necesita ya no le pregunta.
 *
 * Por eso el hook no pide nada hasta que `active` es `true`, y `active` es
 * exactamente "el escáner está abierto". `QrScannerModal` devuelve `null` cuando
 * está cerrado, así que el hook ni siquiera se monta en el caso común.
 *
 * ── Por qué apagar la cámara es parte del hook ───────────────────────────────
 *
 * Porque un `getUserMedia` que no se apaga deja el piloto de la cámara prendido
 * —la persona lo ve en la barra del navegador— aunque nadie esté escaneando. Un
 * piloto prendido en una billetera no es un detalle: es la diferencia entre "la
 * app está leyendo" y "la app está mirando". Se sueltan los tracks en el
 * cleanup, que corre al cerrar, al cancelar y también al desmontar.
 *
 * ── Por qué los errores se nombran en vez de tragarse ────────────────────────
 *
 * Porque son tres cosas distintas con tres arreglos distintos, y `catch` vacío
 * las vuelve una sola: un cartel que dice "error" no le dice a nadie si tiene que
 * tocar el candado del navegador, cambiar de dirección o esperar. Ver
 * `CAMERA_STATUS_TEXT` en `config/qrScan.ts`.
 *
 * ── Por qué nada de lo que pasa acá sale de este archivo ──────────────────────
 *
 * No hay `fetch`, ni `console` con el contenido leído, ni evento de analítica.
 * El frame se dibuja en un canvas, se lee en memoria y, si era un destino, se le
 * entrega al flujo de envío. Lo único que se reporta hacia afuera es un string.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { createQrFrameDecoder } from '../services/qrScan';

/**
 * En qué está la cámara.
 *
 * `denied` y `unavailable` **no** son errores de la app: son dos resultados
 * normales de una pregunta que la persona tiene derecho a decir que no, y por
 * eso son estados nombrados y no una excepción.
 */
export type QrCameraStatus = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'insecure';

/** Lo que el escáner necesita del hook. */
export interface QrScannerController {
  readonly status: QrCameraStatus;
  /** El `<video>` donde se pinta el stream, para que el hook lo pueda leer. */
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Si este dispositivo tiene linterna en la cámara de atrás. */
  readonly torchSupported: boolean;
  readonly torchOn: boolean;
  readonly toggleTorch: () => void;
  /** Vuelve a pedir la cámara, después de un permiso denegado. */
  readonly retry: () => void;
}

/**
 * El decoder de cada `<video>` vivo.
 *
 * Es un `WeakMap` y no un estado de React por una razón práctica: crearlo durante
 * el render es trabajo que React puede descartar, y recrearlo en cada render es
 * trabajo deCpu en cada frame. Acá hay exactamente uno por video y se garbage
 * colecta con el elemento. `createQrFrameDecoder` no guarda nada global.
 */
const decoders = new WeakMap<HTMLVideoElement, ReturnType<typeof createQrFrameDecoder>>();

const TORCH_CAPS_KEY = 'torch';

/**
 * Los errores de `getUserMedia` que significan "no me dejaste".
 *
 * `NotAllowedError` es el permiso denegado —el candado del navegador— y
 * `SecurityError` es lo mismo en un contexto donde el navegador ni siquiera
 * pregunta. Los
 * dos son una decisión de la persona o del navegador, nunca una falla de lectura.
 */
const isDenial = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || error.name === 'SecurityError');

/**
 * El hook del escáner.
 *
 * @param active   `true` sólo mientras el escáner está abierto.
 * @param onDecoded Se llama **una** vez por QR leído, con el texto crudo. Quien
 *                 lo llama decide si sirve: el hook no valida ni transforma.
 */
export const useQrScanner = (
  active: boolean,
  onDecoded: (text: string) => void,
): QrScannerController => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  /*
   * El callback en una ref, y no como dependencia del efecto.
   *
   * El consumidor —la pantalla— cambia de identidad en cada render: si fuera
   * dependencia, el efecto se desarmaría y rearmería la cámara en cada cambio de
   * estado de la pantalla de envío, encendiendo y apagando el piloto de la
   * cámara mientras alguien escanea. Con la ref, el efecto depende sólo de
   * `active`.
   */
  const decodedRef = useRef(onDecoded);
  decodedRef.current = onDecoded;

  const [status, setStatus] = useState<QrCameraStatus>('idle');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /** Suelta la cámara: tracks detenidos y piloto apagado. Idempotente. */
  const releaseCamera = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
    }
  }, []);

  useEffect(() => {
    if (!active) {
      releaseCamera();
      setStatus('idle');
      setTorchSupported(false);
      setTorchOn(false);
      return;
    }

    let alive = true;

    const stop = () => {
      alive = false;
      releaseCamera();
    };

    /**
     * Un frame por cuadro de animación.
     *
     * `requestAnimationFrame` y no un `setInterval`: el navegador llama justo
     * antes de pintar, así que nunca se lee un frame que no se va a ver, y si la
     * pestaña está en segundo plano el navegador deja de llamar y el teléfono se
     * enfría. El `dead` es la única condición de corte: en cuanto se decodificó
 * algo, la cámara se apaga y no se vuelve a leer.
     */
    const readFrames = () => {
      if (!alive) return;

      const video = videoRef.current;
      if (video !== null && video.readyState >= video.HAVE_CURRENT_DATA) {
        const decoder = decoders.get(video);
        if (decoder !== undefined) {
          const text = decoder.decode(video);
          if (text !== null) {
            // Antes de avisar: apagar la cámara. Es el último frame que se lee.
            releaseCamera();
            decodedRef.current(text);
            return;
          }
        }
      }

      frameRef.current = requestAnimationFrame(readFrames);
    };

    const start = async () => {
      setStatus('starting');

      // Sin `https` el navegador no concede cámara ni en localhost alterno, y la
      // falla acá es un mensaje inútil: se dice la causa real.
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        setStatus('insecure');
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          /*
           * `ideal`, no `exact`: un teléfono sin cámara trasera —o con la frontal
           * primero— no es motivo para negarle el escáner a alguien.
           *
           * `audio: false` es explícito: esta app no pide micrófono y no hay
           * razón para que aparezca en el cartel de permisos.
           */
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        // El escáner se cerró mientras el navegador decidía: no queda cámara.
        if (!alive) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & Record<string, unknown>) | undefined;
        setTorchSupported(capabilities?.[TORCH_CAPS_KEY] === true);

        const video = videoRef.current;
        if (video !== null) {
          video.srcObject = stream;
          // `muted` + `playsInline` están en el elemento: sin ellos el navegador
          // bloquea el autoplay y el video queda negro.
          try {
            await video.play();
          } catch {
            /* Un autoplay rechazado no es un error de cámara: se ve igual. */
          }
          decoders.set(video, createQrFrameDecoder());
        }

        if (!alive) {
          releaseCamera();
          return;
        }

        setStatus('scanning');
        frameRef.current = requestAnimationFrame(readFrames);
      } catch (error) {
        if (!alive) return;
        setStatus(isDenial(error) ? 'denied' : 'unavailable');
      }
    };

    void start();

    return stop;
  }, [active, attempt, releaseCamera]);

  const toggleTorch = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track === undefined) return;

    const next = !torchOn;
    try {
      const applied = track.applyConstraints({
        advanced: [{ [TORCH_CAPS_KEY]: next } as MediaTrackConstraintSet],
      });
      void applied
        .then(() => setTorchOn(next))
        .catch(() => {
          /* Si el navegador no puede, la linterna no cambia de estado. */
        });
    } catch {
      /* `applyConstraints` no soportado: el botón queda como estaba. */
    }
  }, [torchOn]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { status, videoRef, torchSupported, torchOn, toggleTorch, retry };
};

