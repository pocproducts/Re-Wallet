import React, { useState } from 'react';
import {
  Search,
  Bell,
  Bug,
  X,
  CheckCircle2,
  Copy,
  Check,
  QrCode,
  Clock,
  Share2,
} from 'lucide-react';
import { UserProfileData, TransactionItem } from '../../types';

interface ActivityViewProps {
  profile: UserProfileData | null;
  transactions?: TransactionItem[];
  onOpenProfile?: () => void;
  onOpenSearch?: () => void;
  onOpenBugModal?: () => void;
  onOpenNotifications?: () => void;
  /**
   * Hay avisos que esta persona todavía no vio en su última visita.
   *
   * Sólo un booleano: el feed vive en `App` y el texto sale del backend. Sin
   * la prop, no hay punto — un punto falso es peor que ningún punto.
   */
  hasUnreadNotifications?: boolean;
}

export const ActivityView: React.FC<ActivityViewProps> = ({
  profile,
  transactions: propTransactions,
  onOpenProfile,
  onOpenSearch,
  onOpenBugModal,
  onOpenNotifications,
  hasUnreadNotifications,
}) => {
  const [selectedTx, setSelectedTx] = useState<TransactionItem | null>(null);
  const [copied, setCopied] = useState(false);

  const userTag = profile?.nombre
    ? '$' + profile.nombre.toLowerCase().replace(/\s+/g, '').slice(0, 10)
    : '$joadata';

  /*
   * La lista es la que llega, tal cual.
   *
   * Antes, cuando no venía nada, esta pantalla fabricaba siete movimientos de
   * ejemplo —cuatro “Compra de Cryptos”, con fechas de septiembre y
   * `- 4.000,00 ARS`, `+ 7,193689 TRX`, `+ 18,93880759 DOGE`,
   * `+ 0,0155256 SOL`— y los pintaba como si fueran de esta persona. El `App`
   * sembraba otros cuatro más.
   *
   * Hoy no hay fuente real de transacciones: `GET /api/portfolio` devuelve
   * saldos, no movimientos, y la pantalla de cobros sólo conoce lo que la
   * persona generó ella en el momento. Eso no se rellena con ejemplos: si no
   * hay nada, la pantalla dice que no hay nada, que es el estado real de una
   * cuenta nueva.
   */
  const transactions = propTransactions ?? [];

  const hoyTx = transactions.filter((t) => t.section === 'Hoy');
  const anterioresTx = transactions.filter((t) => t.section === 'Anteriores');

  const copyHash = (hash: string) => {
    navigator.clipboard?.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Renderizar icono idéntico a la imagen
  const renderAssetIcon = (type: TransactionItem['type']) => {
    if (type === 'qr_charge') {
      return (
        <div className="w-10 h-10 rounded-full bg-black text-[#ccff00] flex items-center justify-center shadow-2xs shrink-0 font-bold border border-slate-900">
          <QrCode className="w-5 h-5 stroke-[2.2]" />
        </div>
      );
    }

    if (type === 'usdc' || type === 'usdt') {
      return (
        <div className="w-10 h-10 rounded-full bg-[#2775CA] text-white flex items-center justify-center shadow-2xs shrink-0 font-bold text-sm">
          $
        </div>
      );
    }

    if (type === 'ars') {
      return (
        <div className="w-10 h-10 rounded-full overflow-hidden flex flex-col justify-between border border-slate-100 shadow-2xs shrink-0 relative bg-white">
          <div className="h-1/3 w-full bg-[#75aadb]" />
          <div className="h-1/3 w-full bg-white flex items-center justify-center relative">
            <div className="w-2.5 h-2.5 rounded-full bg-[#f6b40e] border-[0.5px] border-[#9e6d08] flex items-center justify-center">
              <div className="w-1 h-1 rounded-full bg-[#8c5900]" />
            </div>
          </div>
          <div className="h-1/3 w-full bg-[#75aadb]" />
        </div>
      );
    }

    if (type === 'trx') {
      return (
        <div className="w-10 h-10 rounded-full bg-[#e81919] flex items-center justify-center shadow-2xs shrink-0 text-white font-bold">
          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
            <path d="M1.5 3.5L22.5 1.5L12 22.5L1.5 3.5ZM19 4.3L4.8 5.7L12.5 18.5L19 4.3ZM12 9.5L7.2 7.2L16.2 6.3L12 9.5Z" />
          </svg>
        </div>
      );
    }

    if (type === 'doge') {
      return (
        <div className="w-10 h-10 rounded-full bg-[#e1b303] flex items-center justify-center shadow-2xs shrink-0 overflow-hidden border border-amber-300">
          <span className="text-xl">🐕</span>
        </div>
      );
    }

    if (type === 'sol') {
      return (
        <div className="w-10 h-10 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center shadow-2xs shrink-0">
          <div className="w-5 h-4 flex flex-col justify-between">
            <div className="h-1 w-full rounded-sm bg-gradient-to-r from-[#9945FF] to-[#14F195]" />
            <div className="h-1 w-4/5 self-end rounded-sm bg-gradient-to-r from-[#14F195] to-[#9945FF]" />
            <div className="h-1 w-full rounded-sm bg-gradient-to-r from-[#9945FF] to-[#14F195]" />
          </div>
        </div>
      );
    }

    return (
      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold shrink-0">
        $
      </div>
    );
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-[#f3f4f6] p-4 pb-24 max-w-md mx-auto select-none space-y-4 animate-in fade-in duration-200">
      {/* =========================================================================
          HEADER SUPERIOR: Avatar con $tag + Lupa, Campana
         ========================================================================= */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={onOpenProfile}
          type="button"
          title="Ver perfil de usuario"
          aria-label="Abrir perfil de usuario"
          className="bg-white rounded-full py-1.5 pl-1.5 pr-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-slate-100 flex items-center gap-2.5 active:scale-95 transition-transform cursor-pointer"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-200 via-emerald-300 to-teal-400 p-0.5 flex items-center justify-center overflow-hidden">
            <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center text-xs font-bold text-[#ccff00]">
              {profile?.nombre ? profile.nombre.charAt(0).toUpperCase() : '👾'}
            </div>
          </div>
          <span className="text-sm font-bold text-black font-display tracking-tight">
            {userTag}
          </span>
        </button>

        <div className="flex items-center gap-3 text-black pr-1">
          <button
            onClick={onOpenBugModal}
            type="button"
            aria-label="Reportar Bug o Feedback"
            title="Reportar Bug o Feedback"
            className="w-11 h-11 flex items-center justify-center text-black hover:opacity-75 active:scale-90 transition-all cursor-pointer"
          >
            <Bug className="w-5 h-5 stroke-[2.2]" />
          </button>

          <button
            onClick={onOpenNotifications}
            type="button"
            aria-label={hasUnreadNotifications ? 'Notificaciones: hay avisos nuevos' : 'Notificaciones'}
            title={hasUnreadNotifications ? 'Notificaciones: hay avisos nuevos' : 'Notificaciones'}
            className="w-11 h-11 flex items-center justify-center text-black hover:opacity-75 active:scale-90 transition-all relative cursor-pointer"
          >
            <Bell className="w-5 h-5 stroke-[2.2]" />
            {/*
             * El punto de "hay algo nuevo" va **superpuesto**: `absolute` sobre
             * un botón que ya es `relative`, así que no empuja la campana ni
             * cambia el alto de la fila. Es el único modo de poner una señal acá
             * sin desarmar la composición del header.
             *
             * Lo decide un `id` guardado localmente contra el `id` más nuevo del
             * feed, no un contador inventado — ver `useNotifications`.
             */}
            {hasUnreadNotifications === true && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#ccff00] border border-black"
              />
            )}
          </button>
        </div>
      </div>

      {/* Título Principal Grande "Actividad" */}
      <div className="pt-2 px-1">
        <h1 className="text-2xl font-black font-display text-black tracking-tight">
          Actividad
        </h1>
      </div>

      {/* =========================================================================
          LISTA DE TRANSACCIONES
         ========================================================================= */}
      {/*
        Sin movimientos hay una sola respuesta honesta: decirlo. La misma
        tarjeta blanca del resto de la pantalla, el mismo aire y la misma
        tipografía; lo que cambia es que no hay filas para rellenar.
      */}
      {transactions.length === 0 && (
        <div className="p-6 bg-white/70 rounded-2xl border border-slate-200/50 shadow-2xs space-y-2">
          <span className="text-sm font-bold text-black block">
            Todavía no hay movimientos
          </span>
          <span className="text-xs text-slate-500 font-medium block leading-snug">
            Cuando compres, cobres o pagues, cada movimiento aparece acá con su
            importe y su estado. Ahora mismo no hay nada que mostrar.
          </span>
        </div>
      )}

      <div className="space-y-5">
        {/* SECCIÓN: Hoy */}
        {hoyTx.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-500 font-display px-1">
              Hoy
            </h3>

            <div className="space-y-1">
              {hoyTx.map((tx) => (
                <div
                  key={tx.id}
                  onClick={() => setSelectedTx(tx)}
                  className="p-3 bg-white/70 hover:bg-white rounded-2xl flex items-center justify-between cursor-pointer active:scale-98 transition-all border border-slate-200/50 shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    {renderAssetIcon(tx.type)}
                    <div>
                      <span className="text-sm font-bold text-black block leading-tight">
                        {tx.title}
                      </span>
                      <span className="text-xs text-slate-400 font-medium block mt-0.5">
                        {tx.date}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className={`text-sm font-bold tracking-tight block ${
                        tx.isPositive ? 'text-[#00c076]' : 'text-black'
                      }`}
                    >
                      {tx.amount}
                    </span>
                    {tx.type === 'qr_charge' && (
                      <span className="text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full inline-block mt-0.5">
                        {tx.expiresAt || 'Expira mañana'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECCIÓN: Anteriores */}
        {anterioresTx.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-500 font-display px-1">
              Anteriores
            </h3>

            <div className="space-y-1">
              {anterioresTx.map((tx) => (
                <div
                  key={tx.id}
                  onClick={() => setSelectedTx(tx)}
                  className="p-3 bg-transparent hover:bg-white/80 rounded-2xl flex items-center justify-between cursor-pointer active:scale-98 transition-all"
                >
                  <div className="flex items-center gap-3">
                    {renderAssetIcon(tx.type)}
                    <div>
                      <span className="text-sm font-bold text-black block leading-tight">
                        {tx.title}
                      </span>
                      <span className="text-xs text-slate-400 font-medium block mt-0.5">
                        {tx.date}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className={`text-sm font-bold tracking-tight block ${
                        tx.isPositive ? 'text-[#00c076]' : 'text-black'
                      }`}
                    >
                      {tx.amount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          MODAL DE DETALLE DE LA TRANSACCIÓN O COBRO QR
         ========================================================================= */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-[36px] p-6 shadow-2xl relative space-y-4">
            <button
              onClick={() => setSelectedTx(null)}
              type="button"
              className="absolute top-5 right-5 w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-black hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 pt-1">
              {renderAssetIcon(selectedTx.type)}
              <div>
                <h3 className="text-base font-extrabold text-black font-display">
                  {selectedTx.title}
                </h3>
                <span className="text-xs text-slate-400 font-medium">{selectedTx.date}</span>
              </div>
            </div>

            {/* Tarjeta de Detalles */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Monto</span>
                <span
                  className={`text-base font-black ${
                    selectedTx.isPositive ? 'text-[#00c076]' : 'text-black'
                  }`}
                >
                  {selectedTx.amount}
                </span>
              </div>

              {selectedTx.concept && (
                <div className="flex justify-between items-center pt-2 border-t border-slate-200/60">
                  <span className="text-slate-500 font-medium">Concepto</span>
                  <span className="text-black font-bold truncate max-w-[180px]">
                    {selectedTx.concept}
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center pt-2 border-t border-slate-200/60">
                <span className="text-slate-500 font-medium">Estado</span>
                {selectedTx.type === 'qr_charge' ? (
                  <span className="flex items-center gap-1 font-bold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full text-[11px]">
                    <Clock className="w-3.5 h-3.5 text-amber-700" />
                    <span>Pendiente · {selectedTx.expiresAt || 'Expira mañana'}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Completada
                  </span>
                )}
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-200/60">
                <span className="text-slate-500 font-medium">Red</span>
                <span className="font-mono text-slate-700 font-bold">
                  {selectedTx.type === 'qr_charge' ? 'ReWALLET QR Pay' : 'ReWALLET Ledger'}
                </span>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-200/60">
                <span className="text-slate-500 font-medium">ID de Referencia</span>
                <button
                  onClick={() => copyHash(selectedTx.id)}
                  type="button"
                  className="font-mono text-slate-600 hover:text-black flex items-center gap-1 font-bold cursor-pointer"
                >
                  <span>{selectedTx.id.slice(0, 14)}...</span>
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Código QR si es un cobro */}
            {selectedTx.type === 'qr_charge' && (
              <div className="bg-[#ccff00]/15 border border-[#ccff00] rounded-2xl p-3 text-center space-y-2">
                <span className="text-[11px] font-extrabold text-black uppercase tracking-wider block">
                  Cobro por QR
                </span>
                <div className="w-36 h-36 bg-white mx-auto rounded-xl p-2 border border-black/10 flex items-center justify-center">
                  <QrCode className="w-full h-full text-black stroke-[1.2]" />
                </div>
                <span className="text-[11px] text-slate-600 font-medium block">
                  {selectedTx.expiresAt || 'Expira mañana'}
                </span>
              </div>
            )}

            <button
              onClick={() => setSelectedTx(null)}
              type="button"
              className="w-full min-h-[46px] rounded-2xl bg-black text-[#ccff00] font-extrabold text-xs shadow-md active:scale-98 transition-transform cursor-pointer"
            >
              Cerrar Comprobante
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
