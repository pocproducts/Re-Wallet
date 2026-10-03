/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BottomNavbar } from './components/Navigation/BottomNavbar';
import { WalletView } from './components/Wallet/WalletView';
import { InvestmentsView } from './components/Wallet/InvestmentsView';
import { ActivityView } from './components/Activity/ActivityView';
import { ProfileView } from './components/Profile/ProfileView';
import { FeedbackModal } from './components/Feedback/FeedbackModal';
import { ActionFullscreenModal, ActionModalType } from './components/Wallet/ActionFullscreenModal';
import { QrScannerModal } from './components/Wallet/QrScannerModal';
import { AavePoolsView } from './components/Yield/AavePoolsView';
import { DigitalDollarsView } from './components/Investments/DigitalDollarsView';
import { CryptoAssetsListView } from './components/Investments/CryptoAssetsListView';
import { LoginGate } from './components/Auth/LoginGate';
import { useSessionGate } from './hooks/useSessionGate';
import { ChargeQrModal } from './components/Charge/ChargeQrModal';
import { NavTab, TransactionItem } from './types';
import {
  X,
  Search,
  Bell,
  Loader2,
} from 'lucide-react';

const TRANSACTIONS_STORAGE_KEY = 'rewallet_transactions_data';

export default function App() {
  /*
   * La puerta y el perfil salen de acá. `App` ya no lleva ningún flag de
   * onboarding propio: pregunta al backend si la sesión sigue viva, y el
   * perfil se deriva del usuario de Privy (`hooks/useSessionGate`).
   */
  const {
    ready,
    status: sessionStatus,
    profile,
    exchangeError,
    signOut,
    restartFromCleanState,
  } = useSessionGate();
  const [currentTab, setCurrentTab] = useState<NavTab>('wallet');
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [isBugModalOpen, setIsBugModalOpen] = useState<boolean>(false);
  const [isChargeModalOpen, setIsChargeModalOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeActionModal, setActiveActionModal] = useState<ActionModalType>(null);
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);

  // Estados de layout de 3er nivel
  const [isAavePoolsOpen, setIsAavePoolsOpen] = useState(false);
  const [isDigitalDollarsOpen, setIsDigitalDollarsOpen] = useState(false);
  const [isCryptoListOpen, setIsCryptoListOpen] = useState(false);

  // Saldo mock de Bitcoin
  const [btcBalance, setBtcBalance] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('rewallet_btc_balance');
      return stored ? parseFloat(stored) : 0.000186;
    } catch {
      return 0.000186;
    }
  });

  const handleUpdateBtcBalance = (newVal: number) => {
    setBtcBalance(newVal);
    try {
      localStorage.setItem('rewallet_btc_balance', newVal.toString());
    } catch (e) {
      console.warn('Error saving btc balance:', e);
    }
  };

  // Lista de transacciones en actividad con persistencia
  const [transactions, setTransactions] = useState<TransactionItem[]>([
    {
      id: 'tx-1',
      title: 'Compra de Cryptos',
      date: '25 de Septiembre',
      amount: '- 4.000,00 ARS',
      isPositive: false,
      type: 'ars',
      section: 'Hoy',
    },
    {
      id: 'tx-2',
      title: 'Compra de Cryptos',
      date: '25 de Septiembre',
      amount: '+ 7,193689 TRX',
      isPositive: true,
      type: 'trx',
      section: 'Hoy',
    },
    {
      id: 'tx-3',
      title: 'Compra de Cryptos',
      date: '24 de Septiembre',
      amount: '+ 18,93880759 DOGE',
      isPositive: true,
      type: 'doge',
      section: 'Anteriores',
    },
    {
      id: 'tx-4',
      title: 'Compra de Cryptos',
      date: '24 de Septiembre',
      amount: '- 3.000,00 ARS',
      isPositive: false,
      type: 'ars',
      section: 'Anteriores',
    },
  ]);

  // Cargar las transacciones mock guardadas. El perfil **no** se carga de acá:
  // viene de Privy.
  useEffect(() => {
    try {
      const storedTx = localStorage.getItem(TRANSACTIONS_STORAGE_KEY);
      if (storedTx) {
        const parsedTx = JSON.parse(storedTx);
        if (Array.isArray(parsedTx) && parsedTx.length > 0) {
          setTransactions(parsedTx);
        }
      }
    } catch (e) {
      console.warn('Error reading stored transactions:', e);
    }
  }, []);

  // Agregar nueva transacción / cobro a la actividad
  const handleAddTransaction = (newTx: TransactionItem) => {
    setTransactions((prev) => {
      const updated = [newTx, ...prev];
      try {
        localStorage.setItem(TRANSACTIONS_STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.warn('Error saving transactions:', e);
      }
      return updated;
    });
  };

  /*
   * Cerrar sesión: primero el backend (borra la cookie) y después la de Privy.
   * Lo que se mantiene es lo mismo que estaba antes —transacciones, saldo y
   * posición en las pestañas— porque nada de eso es identidad.
   */
  const handleSignOut = () => {
    void signOut().then(() => {
      setIsProfileOpen(false);
      setIsAavePoolsOpen(false);
      setIsDigitalDollarsOpen(false);
      setIsCryptoListOpen(false);
      setIsScannerOpen(false);
      setActiveActionModal(null);
      setCurrentTab('wallet');
    });
  };

  // Handle visual del usuario ($joaquin / $joadata)
  const userTag = profile?.nombre
    ? '$' + profile.nombre.toLowerCase().replace(/\s+/g, '').slice(0, 10)
    : '$joadata';

  const isAnyThirdLevelOpen =
    isAavePoolsOpen || isDigitalDollarsOpen || isCryptoListOpen;

  /*
   * El botón de "volver a empezar" del fallo de intercambio se deshabilita
   * mientras corre, para que dos cierres de sesión no se pisen.
   */
  const [restarting, setRestarting] = useState(false);

  return (
    /*
     * `min-h-dvh` y no `min-h-screen`: `min-h-screen` es 100vh, que en Android
     con la barra del navegador visible es MÁS ALTO que el `h-dvh` del marco.
     * El resultado era una página scrolleable por detrás de la app, con un
     * rubber band gris al arrastrar. `dvh` es el viewport dinámico: cambia con
     la barra y los dos contadores coinciden siempre.
     */
    <div className="min-h-dvh w-full bg-[#f3f4f6] text-black flex justify-center selection:bg-[#ccff00] selection:text-black">
      {/* Contenedor Responsivo para Teléfonos */}
      <main className="relative w-full max-w-md h-dvh flex flex-col overflow-hidden bg-[#f3f4f6] shadow-2xl">
        {/* =========================================================================
            LA PUERTA DE INGRESO, O NADA:
            `checking` (Privy arranca), `checking_session` (vuela el `GET`) y
            `exchanging` (Privy ya dijo autenticado y estamos abriendo la sesión
            de ReWALLET) muestran todos una pantalla neutra, nunca el formulario.
            Mostrarle el formulario a alguien que ya está autenticado en Privy es
            el bug que esto reemplaza: en ese estado no hay nada que pedir, hay
            un intercambio que hacer.
           ========================================================================= */}
        {sessionStatus === 'checking' ||
        sessionStatus === 'checking_session' ||
        sessionStatus === 'exchanging' ||
        !ready ? (
          <div className="flex-1 w-full h-full bg-[#f8f9fa] flex flex-col items-center justify-center gap-3 font-sans">
            <Loader2 className="w-6 h-6 text-black animate-spin" />
            <p className="text-xs font-medium text-slate-500">
              {sessionStatus === 'exchanging' ? 'Abriendo tu sesión…' : 'Cargando…'}
            </p>
          </div>
        ) : sessionStatus === 'exchange_failed' ? (
          /* =========================================================================
              INTERCAMBIO FALLIDO CON LA PERSONA YA AUTENTICADA EN PRIVY:
              No se reintenta solo (un bucle de `POST` contra un backend roto no
              repara nada) y no se pide un código (sería `cannot_link_more_of_type`).
              La salida que funciona es cerrar la sesión de Privy y volver al
              correo: el próximo intento arranca desde cero y de verdad.
             ========================================================================= */
          <div className="flex-1 w-full h-full bg-[#f8f9fa] text-black flex flex-col justify-center px-6 safe-top-5 safe-bottom-5 font-sans">
            <div className="bg-white border border-slate-200/80 rounded-[28px] p-6 shadow-xs space-y-4">
              <h1 className="text-lg font-black font-display text-black tracking-tight">
                No pudimos abrir tu sesión
              </h1>
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                {exchangeError ??
                  'Entramos a tu cuenta pero no pudimos abrir la sesión de la app.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setRestarting(true);
                  void restartFromCleanState().finally(() => setRestarting(false));
                }}
                disabled={restarting}
                className="w-full min-h-[48px] rounded-2xl bg-black text-[#ccff00] text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60 active:scale-98 transition-transform cursor-pointer"
              >
                {restarting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Cerrando sesión…</span>
                  </>
                ) : (
                  <span>Cerrar sesión y volver a entrar</span>
                )}
              </button>
              <p className="text-[11px] text-slate-400 font-medium leading-snug text-center">
                Cierra tu sesión en Privy y vuelve al ingreso por correo. Eso deja el
                navegador en un estado limpio para el próximo intento.
              </p>
            </div>
          </div>
        ) : sessionStatus === 'anonymous' ? (
          <LoginGate />
        ) : (
          /* =========================================================================
              CUANDO HAY SESIÓN:
              DIV 1: Área Principal (BILLETERA, INVERSIONES, ACTIVIDAD)
              DIV 2: Navbar abajo con los 3 iconos fluidos + Botón circular BUG
             ========================================================================= */
          <>
            {/* DIV 1: Casi toda la pantalla con transiciones fluidas */}
            <div
              id="screen-main-content"
              className="flex-1 relative w-full h-full overflow-hidden bg-[#f3f4f6]"
            >
              {/* MODAL / LAYOUT DE PERFIL (Se abre al presionar el avatar $tag) */}
              {isProfileOpen ? (
                <div className="absolute inset-0 z-50 bg-[#f3f4f6] safe-top-0 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <ProfileView
                    profile={profile}
                    onResetOnboarding={handleSignOut}
                    onClose={() => setIsProfileOpen(false)}
                  />
                </div>
              ) : (
                <>
                  {/* Pestaña 1: BILLETERA */}
                  {currentTab === 'wallet' && (
                    <div className="absolute inset-0 z-20 bg-[#f3f4f6] safe-top-0 animate-in fade-in duration-200">
                      <WalletView
                        profile={profile}
                        onOpenProfile={() => setIsProfileOpen(true)}
                        onNavigateToInvestments={() => setCurrentTab('investments')}
                        onNavigateToActivity={() => setCurrentTab('activity')}
                        onOpenAction={(act) => setActiveActionModal(act)}
                        onOpenSearch={() => setIsSearchOpen(true)}
                        onOpenScanner={() => setIsScannerOpen(true)}
                        onOpenBugModal={() => setIsBugModalOpen(true)}
                        onOpenNotifications={() => setIsNotificationsOpen(true)}
                        onOpenAavePools={() => setIsAavePoolsOpen(true)}
                      />
                    </div>
                  )}

                  {/* Pestaña 2: INVERSIONES */}
                  {currentTab === 'investments' && (
                    <div className="absolute inset-0 z-20 bg-[#f3f4f6] safe-top-0 animate-in fade-in duration-200">
                      <InvestmentsView
                        profile={profile}
                        onOpenProfile={() => setIsProfileOpen(true)}
                        onNavigateToWallet={() => setCurrentTab('wallet')}
                        onOpenSearch={() => setIsSearchOpen(true)}
                        onOpenBugModal={() => setIsBugModalOpen(true)}
                        onOpenNotifications={() => setIsNotificationsOpen(true)}
                        onOpenDigitalDollars={() => setIsDigitalDollarsOpen(true)}
                        onOpenCryptoList={() => setIsCryptoListOpen(true)}
                      />
                    </div>
                  )}

                  {/* Pestaña 3: ACTIVIDAD (Transacciones) */}
                  {currentTab === 'activity' && (
                    <div className="absolute inset-0 z-20 bg-[#f3f4f6] safe-top-0 animate-in fade-in duration-200">
                      <ActivityView
                        profile={profile}
                        transactions={transactions}
                        onOpenProfile={() => setIsProfileOpen(true)}
                        onOpenSearch={() => setIsSearchOpen(true)}
                        onOpenBugModal={() => setIsBugModalOpen(true)}
                        onOpenNotifications={() => setIsNotificationsOpen(true)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            {/* DIV 2: Navbar mobile abajo (Oculto en layouts de 3er nivel) */}
            {!isAnyThirdLevelOpen && !activeActionModal && (
              <div id="mobile-navbar-container" className="w-full shrink-0">
                <BottomNavbar
                  currentTab={currentTab}
                  onTabChange={(tab) => {
                    setIsProfileOpen(false);
                    setActiveActionModal(null);
                    setCurrentTab(tab);
                  }}
                  onOpenChargeModal={() => setIsChargeModalOpen(true)}
                  onOpenBugModal={() => setIsChargeModalOpen(true)}
                />
              </div>
            )}
          </>
        )}

        {/* Modal de Cobro y Pago con QR de Pantalla Completa Verde Lima (Botón flotante en Navbar) */}
        <ChargeQrModal
          isOpen={isChargeModalOpen}
          onClose={() => setIsChargeModalOpen(false)}
          userTag={userTag}
          btcBalance={btcBalance}
          onUpdateBtcBalance={handleUpdateBtcBalance}
          onAddTransaction={handleAddTransaction}
          onNavigateToActivity={() => {
            setIsChargeModalOpen(false);
            setCurrentTab('activity');
          }}
        />

        {/* =========================================================================
            MODAL DE ACCIÓN PANTALLA COMPLETA VERDE LIMA (DEPOSITAR, USAR, ENVIAR)
            CUBRE TODA LA PANTALLA
           ========================================================================= */}
        <ActionFullscreenModal
          action={activeActionModal}
          onClose={() => setActiveActionModal(null)}
          userTag={userTag}
        />

        {/* =========================================================================
            LAYOUTS DE 3ER NIVEL (PANTALLA COMPLETA SIN HEADER SUPERIOR NI BOTTOM NAVBAR)
           ========================================================================= */}

        {/* 1. Rendimientos Pools de Aave V3 (3er nivel desde píldora 20.77% anual o ver más) */}
        {isAavePoolsOpen && (
          <AavePoolsView
            onBack={() => setIsAavePoolsOpen(false)}
          />
        )}

        {/* 2. Dólares Digitales (3er nivel desde Inversiones -> Dólares Digitales) */}
        {isDigitalDollarsOpen && (
          <DigitalDollarsView
            onBack={() => setIsDigitalDollarsOpen(false)}
            onOpenAavePools={() => {
              setIsDigitalDollarsOpen(false);
              setIsAavePoolsOpen(true);
            }}
          />
        )}

        {/* 3. Bitcoin & Crypto (3er nivel desde Inversiones -> Bitcoin & Crypto, sumatoria + 10 assets) */}
        {isCryptoListOpen && (
          <CryptoAssetsListView
            onBack={() => setIsCryptoListOpen(false)}
            userTag={userTag}
          />
        )}

        {/* Modal de Feedback & Reportar Bugs (Botón BUG Flotante) */}
        <FeedbackModal
          isOpen={isBugModalOpen}
          onClose={() => setIsBugModalOpen(false)}
          userTag={userTag}
        />

        {/* Modal Escáner QR de Cámara (Icono QR en cabecera de Billetera) */}
        <QrScannerModal
          isOpen={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          onScanSuccess={(scanned) => {
            setIsScannerOpen(false);
            setActiveActionModal('enviar');
          }}
        />

        {/* Modal de Búsqueda Rápida */}
        {isSearchOpen && (
          <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center px-4 pb-4 safe-top-12 animate-in fade-in duration-200">
            <div className="w-full max-w-sm bg-white rounded-[32px] p-5 shadow-2xl relative space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#ccff00] text-black flex items-center justify-center">
                    <Search className="w-4 h-4 stroke-[2.5]" />
                  </div>
                  <h3 className="text-sm font-extrabold font-display text-black">
                    Buscar en la Cuenta
                  </h3>
                </div>
                <button
                  onClick={() => setIsSearchOpen(false)}
                  type="button"
                  className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-black hover:bg-slate-200 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar activo, contacto o movimiento..."
                  className="w-full min-h-[44px] bg-slate-50 border border-slate-200 focus:border-black rounded-2xl px-3.5 text-base text-black placeholder-slate-400 focus:outline-none transition-colors font-medium"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5 pt-1 text-xs">
                <span className="text-[11px] font-bold uppercase text-slate-400 font-display">
                  Accesos rápidos
                </span>
                <div
                  onClick={() => {
                    setCurrentTab('investments');
                    setIsSearchOpen(false);
                  }}
                  className="p-2.5 rounded-xl hover:bg-slate-50 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span className="font-bold text-black">Bitcoin & Crypto</span>
                  <span className="text-[11px] text-[#00c076] font-bold">Ver cartera</span>
                </div>
                <div
                  onClick={() => {
                    setCurrentTab('activity');
                    setIsSearchOpen(false);
                  }}
                  className="p-2.5 rounded-xl hover:bg-slate-50 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span className="font-bold text-black">Historial de Compras</span>
                  <span className="text-[11px] text-slate-400">Actividad</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Notificaciones */}
        {isNotificationsOpen && (
          <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center px-4 pb-4 safe-top-12 animate-in fade-in duration-200">
            <div className="w-full max-w-sm bg-white rounded-[32px] p-5 shadow-2xl relative space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-black text-[#ccff00] flex items-center justify-center">
                    <Bell className="w-4 h-4 stroke-[2.2]" />
                  </div>
                  <h3 className="text-sm font-extrabold font-display text-black">
                    Notificaciones
                  </h3>
                </div>
                <button
                  onClick={() => setIsNotificationsOpen(false)}
                  type="button"
                  className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-black hover:bg-slate-200 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/*
               * "Face ID Activo" se fue de acá.
               *
               * Decía, con un tilde verde, que la sesión biométrica estaba
               * protegida — y no había **nada** detrás: era un texto fijo que se
               * mostrara que la passkey existiera o no. La Hoja 1 prohibe que la
               * persona vea un estado que el sistema no comprobó, y una
               * notificación con tilde verde es la forma más cara de mentir:
               * nadie la cuestiona.
               *
               * No se reemplaza con otro avisofixed: se deja de avisar. Cuando
               * el flujo de Privy esté probado y sepamos leer del usuario si
               * tiene una passkey, se vuelve a mostrar **derivado de ese dato**.
               */}
              <div className="space-y-2.5 text-xs">

                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-[#ccff00] text-black font-bold flex items-center justify-center text-[11px] shrink-0 mt-0.5">
                    $
                  </div>
                  <div>
                    <span className="font-bold text-black block">Rendimiento Activo (20.77%)</span>
                    <span className="text-slate-500 text-[11px]">Tus fondos en pesos están generando rendimiento anual diario.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
