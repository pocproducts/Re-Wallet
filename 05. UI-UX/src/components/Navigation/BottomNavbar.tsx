import React from 'react';
import { Wallet, TrendingUp, Clock, QrCode } from 'lucide-react';
import { NavTab } from '../../types';

interface BottomNavbarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  /**
   * Si viene, dibuja la columna QR **fuera** de la cápsula del navbar, en la
   * misma fila: dos secciones — la nav más larga y el botón QR al lado — sin
   * meter el QR dentro del navbar.
   */
  onScanQr?: () => void;
}

export const BottomNavbar: React.FC<BottomNavbarProps> = ({
  currentTab,
  onTabChange,
  onScanQr,
}) => {
  const tabs: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'wallet', label: 'Billetera', icon: Wallet },
    { id: 'investments', label: 'Inversiones', icon: TrendingUp },
    { id: 'activity', label: 'Actividad', icon: Clock },
  ];

  return (
    <nav
      aria-label="Barra de navegación principal"
      className="relative z-40 w-full px-4 pt-2 safe-bottom-6 bg-transparent select-none shrink-0"
    >
      {/* Una fila, dos secciones: navbar (columna larga) + QR (columna corta, fuera de la cápsula) */}
      <div className="flex items-center gap-3 max-w-md mx-auto">
        {/* Columna 1: cápsula flotante blanca principal SOLO 3 TABS */}
        <div className="flex-1 h-14 bg-white/95 backdrop-blur-md rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-slate-200/80 flex items-center justify-around px-3 relative overflow-hidden">
          {tabs.map((tab) => {
            const isActive = currentTab === tab.id;
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                type="button"
                title={tab.label}
                aria-label={tab.label}
                className="relative min-h-[44px] min-w-[48px] p-2 rounded-full flex items-center justify-center transition-all duration-300 ease-out active:scale-90 cursor-pointer"
              >
                <div
                  className={`w-12 h-10 rounded-2xl flex items-center justify-center transition-all duration-300 ease-out ${
                    isActive
                      ? 'bg-[#ccff00] text-black shadow-sm scale-100'
                      : 'bg-transparent text-slate-400 hover:text-slate-600 scale-95'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 transition-transform duration-300 ${
                      isActive ? 'stroke-[2.5] scale-110' : 'stroke-[1.9]'
                    }`}
                  />
                </div>
                <div
                  className={`absolute -bottom-0.5 w-1.5 h-1.5 rounded-full bg-black transition-all duration-300 ${
                    isActive ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Columna 2: botón QR, afuera de la cápsula pero en la misma fila */}
        {onScanQr && (
          <button
            onClick={onScanQr}
            type="button"
            aria-label="Escanear QR"
            title="Escanear QR"
            className="w-14 h-14 shrink-0 rounded-full bg-black flex items-center justify-center shadow-[0_8px_25px_rgba(0,0,0,0.3)] active:scale-90 transition-transform cursor-pointer border border-slate-800"
          >
            <QrCode className="w-6 h-6 text-[#ccff00] stroke-[2.2]" />
          </button>
        )}
      </div>
    </nav>
  );
};