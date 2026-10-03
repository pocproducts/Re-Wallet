import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  QrCode,
  Zap,
  ZapOff,
  Image,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  Copy,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess?: (scannedData: string) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [manualTag, setManualTag] = useState('');
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) {
      // Stop video stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setScannedResult(null);
      return;
    }

    let isMounted = true;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          if (isMounted) setHasCameraPermission(false);
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setHasCameraPermission(true);
      } catch (err) {
        console.warn('Camera access error or restricted in iframe:', err);
        if (isMounted) setHasCameraPermission(false);
      }
    }

    startCamera();

    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSimulateScan = (tag: string) => {
    setScannedResult(tag);
    try {
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 } });
    } catch {}
    if (onScanSuccess) {
      onScanSuccess(tag);
    }
  };

  const handleConfirmManual = () => {
    if (!manualTag.trim()) return;
    const formatted = manualTag.startsWith('$') ? manualTag : `$${manualTag}`;
    handleSimulateScan(formatted);
  };

  return (
    <div className="absolute inset-0 z-50 bg-[#0d0d0f] text-white flex flex-col justify-between safe-top-0 safe-bottom-0 select-none animate-in fade-in duration-200 overflow-hidden font-sans w-full max-w-md mx-auto">
      {/* =========================================================================
          CABECERA SUPERIOR: BOTÓN CERRAR + TÍTULO + LINTERNA
         ========================================================================= */}
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

        <button
          onClick={() => setFlashlightOn(!flashlightOn)}
          type="button"
          aria-label="Linterna"
          className={`w-11 h-11 rounded-full backdrop-blur-md flex items-center justify-center transition-all cursor-pointer ${
            flashlightOn ? 'bg-[#ccff00] text-black shadow-md' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          {flashlightOn ? (
            <Zap className="w-5 h-5 fill-current stroke-[2]" />
          ) : (
            <ZapOff className="w-5 h-5 stroke-[2]" />
          )}
        </button>
      </div>

      {/* =========================================================================
          ÁREA CENTRAL DEL ESCÁNER Y VIEWFINDER
         ========================================================================= */}
      <div className="flex-1 relative flex flex-col items-center justify-center p-6 overflow-hidden">
        {/* Feed de la Cámara Real */}
        {hasCameraPermission ? (
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          /* Simulación visual de escáner en alta fidelidad cuando no hay cámara física en iframe */
          <div className="absolute inset-0 bg-[#0d0d0f] flex flex-col items-center justify-center p-6 text-center">
            <div className="w-full h-full absolute inset-0 opacity-20 bg-[radial-gradient(#ccff00_1px,transparent_1px)] [background-size:16px_16px]" />
          </div>
        )}

        {/* Máscara oscura circular / cuadrada alrededor del visor */}
        <div className="relative z-10 w-64 h-64 sm:w-72 sm:h-72 rounded-3xl border-2 border-white/20 p-2 flex items-center justify-center">
          {/* 4 Esquinas en verde lima */}
          <div className="absolute -top-1 -left-1 w-7 h-7 border-t-4 border-l-4 border-[#ccff00] rounded-tl-xl" />
          <div className="absolute -top-1 -right-1 w-7 h-7 border-t-4 border-r-4 border-[#ccff00] rounded-tr-xl" />
          <div className="absolute -bottom-1 -left-1 w-7 h-7 border-b-4 border-l-4 border-[#ccff00] rounded-bl-xl" />
          <div className="absolute -bottom-1 -right-1 w-7 h-7 border-b-4 border-r-4 border-[#ccff00] rounded-br-xl" />

          {/* Línea láser de escaneo animada */}
          <div className="absolute inset-x-3 h-0.5 bg-[#ccff00] shadow-[0_0_15px_#ccff00] animate-bounce" />

          {/* Icono central de guía */}
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/30 backdrop-blur-xs">
            <QrCode className="w-8 h-8 stroke-[1.5]" />
          </div>
        </div>

        {/* Instrucción visual debajo del visor */}
        <p className="relative z-10 text-xs font-semibold text-slate-300 mt-6 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
          Apuntá la cámara al código QR de otra cuenta o wallet
        </p>

        {/* Modal de Resultado Detectado */}
        {scannedResult && (
          <div className="absolute inset-x-4 bottom-4 z-30 bg-white rounded-3xl p-5 text-black shadow-2xl animate-in slide-in-from-bottom-3 duration-200 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
              </div>
              <div className="flex-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase block">Código detectado</span>
                <span className="text-base font-black font-display text-black block tracking-tight">
                  {scannedResult}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                onClose();
              }}
              type="button"
              className="w-full py-3.5 bg-[#ccff00] hover:bg-[#b8e600] text-black font-extrabold text-xs rounded-2xl active:scale-95 transition-all shadow-sm flex items-center justify-center gap-1.5"
            >
              <span>Continuar con {scannedResult}</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        )}
      </div>

      {/* =========================================================================
          PARTE INFERIOR: ACCESOS RÁPIDOS Y ENTRADA MANUAL DE LEMONTAG
         ========================================================================= */}
      <div className="p-4 pb-6 space-y-3 shrink-0 z-20 bg-gradient-to-t from-black via-black/90 to-transparent">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display block text-center">
          O probá escanear un tag rápido
        </span>

        {/* Chips de tags rápidos para prueba instantánea */}
        <div className="flex items-center justify-center gap-2 overflow-x-auto pb-1">
          {['$lujyyctz', '$faccha20', '$rapsesino', '$santiagodiazdj2'].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => handleSimulateScan(tag)}
              className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-xs font-bold text-white transition-all border border-white/10 shrink-0"
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Input manual */}
        <div className="flex items-center gap-2 bg-white/10 rounded-2xl p-1.5 border border-white/15">
          <input
            type="text"
            value={manualTag}
            onChange={(e) => setManualTag(e.target.value)}
            placeholder="Ingresar $tag manualmente..."
            /* `min-w-0`: sin él el `min-width: auto` del item flex impide encoger el
               input y el campo se sale de la fila en pantallas angostas. */
            className="flex-1 min-w-0 bg-transparent px-3 text-base text-white placeholder-slate-400 focus:outline-none font-medium"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmManual();
            }}
          />
          <button
            type="button"
            onClick={handleConfirmManual}
            className="px-3.5 py-2 rounded-xl bg-[#ccff00] hover:bg-[#b8e600] active:scale-95 text-black font-extrabold text-xs transition-all shrink-0 cursor-pointer"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};
