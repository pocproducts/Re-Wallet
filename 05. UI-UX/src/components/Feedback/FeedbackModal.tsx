import React, { useState } from 'react';
import {
  Bug,
  X,
  Send,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  HelpCircle,
  Smartphone,
  Check,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  userTag: string;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  isOpen,
  onClose,
  userTag,
}) => {
  const [category, setCategory] = useState<'bug' | 'payment' | 'idea' | 'other'>('bug');
  const [comment, setComment] = useState('');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSubmitted(true);
      try {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#ccff00', '#000000', '#10b981'],
        });
      } catch (err) {
        console.warn('Confetti error:', err);
      }
    }, 900);
  };

  const handleReset = () => {
    setIsSubmitted(false);
    setComment('');
    onClose();
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 pt-4 safe-bottom-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-white rounded-[36px] p-6 shadow-2xl relative space-y-4 text-left border border-slate-100">
        {/* Botón Cerrar */}
        <button
          onClick={onClose}
          type="button"
          aria-label="Cerrar formulario"
          className="absolute top-5 right-5 w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-black hover:bg-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Header del modal con icono de BUG */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-black text-[#ccff00] flex items-center justify-center shadow-md">
                <Bug className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="text-base font-extrabold font-display text-black">
                  Reportar Bug & Feedback
                </h3>
                <p className="text-[11px] text-slate-400 font-medium">
                  Tu reporte ayuda a mejorar la experiencia de pagos
                </p>
              </div>
            </div>

            {/* Categorías tipo botones pill */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display">
                ¿Qué tipo de reporte es?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCategory('bug')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center gap-2 border transition-all ${
                    category === 'bug'
                      ? 'bg-black text-[#ccff00] border-black shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Bug className="w-3.5 h-3.5" />
                  <span>Bug o Error</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCategory('payment')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center gap-2 border transition-all ${
                    category === 'payment'
                      ? 'bg-black text-[#ccff00] border-black shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Transacción</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCategory('idea')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center gap-2 border transition-all ${
                    category === 'idea'
                      ? 'bg-black text-[#ccff00] border-black shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Sugerencia</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCategory('other')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center gap-2 border transition-all ${
                    category === 'other'
                      ? 'bg-black text-[#ccff00] border-black shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Otro</span>
                </button>
              </div>
            </div>

            {/* Campo de Texto para descripción */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-display">
                Detalle del problema
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Describe qué ocurrió, en qué pantalla o qué te gustaría mejorar..."
                rows={3}
                required
                className="w-full bg-slate-50 border border-slate-200 focus:border-black rounded-2xl p-3 text-xs text-black placeholder-slate-400 focus:outline-none transition-colors resize-none font-medium"
              />
            </div>

            {/* Switch de inclusión de datos técnicos */}
            <div
              onClick={() => setIncludeDiagnostics(!includeDiagnostics)}
              className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100 cursor-pointer active:opacity-90"
            >
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-slate-400" />
                <div>
                  <span className="text-xs font-bold text-black block leading-none">
                    Adjuntar telemetría técnica
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    ID: {userTag} • Build 2026.9
                  </span>
                </div>
              </div>

              <div
                className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                  includeDiagnostics
                    ? 'bg-black border-black text-[#ccff00]'
                    : 'bg-white border-slate-300'
                }`}
              >
                {includeDiagnostics && <Check className="w-3.5 h-3.5 stroke-[3]" />}
              </div>
            </div>

            {/* Botón Enviar */}
            <button
              type="submit"
              disabled={isSubmitting || !comment.trim()}
              className="w-full min-h-[48px] rounded-full bg-black hover:bg-slate-900 disabled:opacity-50 text-[#ccff00] font-bold text-xs flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
            >
              {isSubmitting ? (
                <span>Enviando reporte...</span>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Enviar Reporte</span>
                </>
              )}
            </button>
          </form>
        ) : (
          /* Estado exitoso */
          <div className="py-6 text-center space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-[#ccff00] text-black flex items-center justify-center shadow-lg">
              <CheckCircle2 className="w-9 h-9 stroke-[2.2]" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-black font-display text-black">
                ¡Gracias por tu Feedback!
              </h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                Hemos recibido tu reporte correctamente. Nuestro equipo lo revisará para seguir optimizando la aplicación.
              </p>
            </div>

            <button
              onClick={handleReset}
              type="button"
              className="w-full min-h-[46px] rounded-full bg-black text-[#ccff00] font-bold text-xs shadow-md"
            >
              Volver a la App
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
