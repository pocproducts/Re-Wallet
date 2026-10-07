import React from 'react';
import { Wallet, TrendingUp, Clock, QrCode } from 'lucide-react';
import { NavTab } from '../../types';

interface BottomNavbarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onOpenChargeModal?: () => void;
  onOpenBugModal?: () => void;
}

export const BottomNavbar: React.FC<BottomNavbarProps> = ({
  currentTab,
  onTabChange,
  onOpenChargeModal,
  onOpenBugModal,
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
      /*
       * `safe-bottom-6` y no `safe-bottom-4`: 24px de aire más la barra de inicio.
       *
       * Con 16px la cápsula flotante y el botón de Cobrar quedaban visualmente
       * pegados al borde inferior. 24px es lo que ya usan las pantallas a
       * pantalla completa (`safe-bottom-6` en los modales lima), así que navbar y
       * modales comparten el mismo aire en lugar de tener dos medidas distintas.
       *
       * El `calc()` de la utility es obligatorio: sin él el navegador descarta la
       * declaración y el padding queda en 0 aunque la clase esté en el HTML.
       */
      className="relative z-40 w-full px-4 pt-2 safe-bottom-6 bg-transparent select-none shrink-0"
    >
      <div className="flex items-center justify-between gap-3 max-w-md mx-auto">
        {/* Cápsula flotante blanca principal SOLO CON ICONOS y transición fluida */}
        <div className="flex-1 h-14 bg-white/95 backdrop-blur-md rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-slate-200/80 flex items-center justify-around px-3 relative overflow-hidden">
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
                {/* Fondo activo fluido verde lima neón */}
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

                {/* Micro-indicador de estado inferior */}
                <div
                  className={`absolute -bottom-0.5 w-1.5 h-1.5 rounded-full bg-black transition-all duration-300 ${
                    isActive ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Botón Circular Flotante de COBRAR con QR (reemplazando el botón BUG) */}
        <button
          onClick={onOpenChargeModal || onOpenBugModal}
          type="button"
          title="Cobrar con QR"
          aria-label="Cobrar con QR"
          className="w-14 h-14 rounded-full bg-black flex items-center justify-center shadow-[0_8px_25px_rgba(0,0,0,0.25)] shrink-0 active:scale-90 transition-transform duration-200 border border-slate-800 group cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[#ccff00] group-hover:scale-110 transition-transform duration-200">
            <QrCode className="w-6 h-6 stroke-[2.2]" />
          </div>
        </button>
      </div>
    </nav>
  );
};
