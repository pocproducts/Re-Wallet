/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { useNotifications } from './hooks/useNotifications';
import { usePortfolio } from './hooks/usePortfolio';
import { useUserWallets } from './hooks/useUserWallets';
import { ChargeQrModal, type ChargeReceiveAddress } from './components/Charge/ChargeQrModal';
import { NavTab, TransactionItem } from './types';
import { relativeTimeLabel, treatmentFor, NOTIFICATIONS_UNAVAILABLE_CODE } from './services/notifications';
import {
  X,
  Search,
  Bell,
  Loader2,
  RefreshCw,
  User,
  ShieldCheck,
  Wallet,
  Link2,
} from 'lucide-react';

const TRANSACTIONS_STORAGE_KEY = 'rewallet_transactions_data';

/*
 * El ícono de cada categoría. Es el **único** mapa de categoría→pintura que
 * existe: si mañana el backend emite otra, cae en `other` (`Bell`) y se muestra
 * igual, con su frase, en vez de romper la fila.
 */
const CATEGORY_ICONS = {
  user: User,
  shield: ShieldCheck,
  wallet: Wallet,
  link: Link2,
  bell: Bell,
} as const;

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

  /*
   * Las wallets se preparan **después** de entrar, nunca antes: sólo corre cuando
   * la sesión de ReWALLET ya está abierta y Privy ya dice autenticado.
   *
   * Un fallo acá no cambia `sessionStatus` ni muestra una pantalla de error: la
   * persona está adentro y se le avisa. Un problema con las wallets es un problema
   * que se muestra, no un muro. Lo único que cambia es el aviso de abajo.
   */
  const { status: walletsStatus } = useUserWallets(sessionStatus === 'authenticated');

  /*
   * Los saldos se leen UNA vez por sesión, acá y no en cada pantalla.
   *
   * `GET /api/portfolio` va a la blockchain por request —el backend no cachea a
   * propósito—, así que un hook por pantalla sería una lectura por cada
   * navegación. El `App` lee una vez y le pasa el resultado a las tres vistas.
   *
   * Corre únicamente con la sesión abierta: la cookie es lo que prueba que hay
   * sesión, y antes de eso la lectura no sirve.
   */
  const portfolio = usePortfolio(sessionStatus === 'authenticated');

  /*
   * Los avisos de la cuenta también se leen UNA vez por sesión, con el mismo
   * corte que `usePortfolio`: `GET /api/notifications` es un `GET` con cookie, no
   * hay push ni canal en vivo, así que se lee al cargar y cuando la persona
   * recarga a mano.
   */
  const notifications = useNotifications(sessionStatus === 'authenticated');
  const [walletsWarningDismissed, setWalletsWarningDismissed] = useState<boolean>(false);
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

  /*
   * Actividad arranca **vacía**.
   *
   * Antes el estado inicial eran cuatro movimientos escritos a mano —cuatro
   * “Compra de Cryptos”, con fecha de septiembre, `- 4.000,00 ARS`,
   * `+ 7,193689 TRX`, `+ 18,93880759 DOGE`— y se guardaban en `localStorage`, así
   * que seguían ahí después de cada recarga. Eran la prueba visible de que
   * aquella persona había movido plata que nunca movió.
   *
   * Hoy la lista es exactamente lo que el backend conoce: nada. El array sigue
   * viviendo acá porque los cobros que la persona **crea** en la app sí son un
   * hecho —uno lo generó ella y lo puede ver—, pero ya no se siembra con
   * ejemplos.
   */
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);

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
   * La dirección de cobro: la primera red real que el backend reportó.
   *
   * Antes el modal de cobrar usaba un saldo de Bitcoin escrito a mano y un
   * `@user` como destino. Ahora usa la dirección que devolvió
   * `GET /api/portfolio`, y si no hay ninguna no genera el cobro: es preferible
   * no poder cobrar antes que mostrar un QR que no lleva a ninguna parte.
   */
  const receiveAddress = useMemo<ChargeReceiveAddress | null>(() => {
    const first = portfolio.receiveAddresses[0];
    return first ? { label: first.label, address: first.address } : null;
  }, [portfolio.receiveAddresses]);

  /*
   * Cerrar sesión: primero el backend (borra la cookie) y después la de Privy.
   * Lo que se mantiene es lo mismo que estaba antes —transacciones y posición
   * en las pestañas— porque nada de eso es identidad. El saldo mock que
   * también se mantenía acá ya no existe.
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

  /*
   * Un 401 en el feed de avisos significa que esta persona **ya no tiene
   * sesión** —la cookie era la que autorizaba la lectura—, no que los avisos
   * estuvieran rotos. La salida es la misma de siempre: cerrar sesión. Abrir un
   * modal para alguien que ya está afuera sería mostrarle avisos de una cuenta a
   * la que no tiene acceso.
   */
  const signedOutHandled = useRef<boolean>(false);

  useEffect(() => {
    if (!notifications.signedOut) {
      signedOutHandled.current = false;
      return;
    }

    // Una sola vez por episode: si no, el efecto vuelve a cerrar sesión cada
    // render mientras el 401 siga en pantalla.
    if (signedOutHandled.current) return;
    signedOutHandled.current = true;

    void signOut();
  }, [notifications.signedOut, signOut]);

  /*
   * Abrir el modal ES la visita: desde acá en adelante lo más reciente se
   * cuenta como visto. Sin esto el punto de la campana no se apagaría nunca.
   *
   * las dependencias son las dos cosas que realmente cambian —que el modal esté
   * abierto y la identidad de `markSeen`, que sólo cambia cuando llegó un feed
   * nuevo—. Depender del objeto entero de avisos volvería a disparar el efecto
   * cada vez que el marcador local cambia, o sea siempre.
   */
  const notificationsStatus = notifications.status;
  const markNotificationsSeen = notifications.markSeen;

  useEffect(() => {
    if (!isNotificationsOpen) return;
    if (notificationsStatus !== 'ready') return;

    markNotificationsSeen();
  }, [isNotificationsOpen, notificationsStatus, markNotificationsSeen]);

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
            {/* AVISO DE WALLETS: informativo, nunca bloqueante */}
            {walletsStatus === 'failed' && !walletsWarningDismissed && (
              <div className="w-full shrink-0 px-4 pt-3 font-sans">
                <div className="flex items-start gap-2.5 rounded-2xl bg-white border border-amber-200/80 px-3.5 py-3 shadow-xs">
                  <div className="flex-1">
                    <p className="text-[12px] font-black text-black leading-snug">
                      No pudimos preparar tus billeteras
                    </p>
                    <p className="text-[11px] font-medium text-slate-600 leading-snug mt-0.5">
                      Podés seguir usando la app. Para recibir o mover fondos vas a
                      necesitarlas: cerrá sesión y volvé a entrar para reintentarlo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWalletsWarningDismissed(true)}
                    aria-label="Cerrar aviso"
                    className="w-6 h-6 shrink-0 rounded-full text-slate-400 flex items-center justify-center hover:text-black transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5 stroke-[2.5]" />
                  </button>
                </div>
              </div>
            )}

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
                        portfolio={portfolio}
                        onOpenProfile={() => setIsProfileOpen(true)}
                        onNavigateToInvestments={() => setCurrentTab('investments')}
                        onNavigateToActivity={() => setCurrentTab('activity')}
                        onOpenAction={(act) => setActiveActionModal(act)}
                        onOpenSearch={() => setIsSearchOpen(true)}
                        onOpenScanner={() => setIsScannerOpen(true)}
                        onOpenBugModal={() => setIsBugModalOpen(true)}
                        onOpenNotifications={() => setIsNotificationsOpen(true)}
                        hasUnreadNotifications={notifications.hasUnread}
                        onOpenAavePools={() => setIsAavePoolsOpen(true)}
                      />
                    </div>
                  )}

                  {/* Pestaña 2: INVERSIONES */}
                  {currentTab === 'investments' && (
                    <div className="absolute inset-0 z-20 bg-[#f3f4f6] safe-top-0 animate-in fade-in duration-200">
                      <InvestmentsView
                        profile={profile}
                        portfolio={portfolio}
                        onOpenProfile={() => setIsProfileOpen(true)}
                        onNavigateToWallet={() => setCurrentTab('wallet')}
                        onOpenSearch={() => setIsSearchOpen(true)}
                        onOpenBugModal={() => setIsBugModalOpen(true)}
                        onOpenNotifications={() => setIsNotificationsOpen(true)}
                        hasUnreadNotifications={notifications.hasUnread}
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
                        hasUnreadNotifications={notifications.hasUnread}
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
          receiveAddress={receiveAddress}
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

        {/* 1. Rendimientos Pools de Aave V3 (3er nivel desde Inversiones -> Ver más) */}
        {isAavePoolsOpen && (
          <AavePoolsView
            onBack={() => setIsAavePoolsOpen(false)}
          />
        )}

        {/* 2. Dólares Digitales (3er nivel desde Inversiones -> Dólares Digitales) */}
        {isDigitalDollarsOpen && (
          <DigitalDollarsView
            onBack={() => setIsDigitalDollarsOpen(false)}
            portfolio={portfolio}
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
            portfolio={portfolio}
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

        {/*
         * MODAL DE NOTIFICACIONES — lo que pasó en esta cuenta, y nada más.
         *
         * Cada fila dice **exactamente** lo que dice el backend: `message`
         * verbatim, la hora derivada de `createdAt` y el ícono de la categoría.
         * No hay texto de esta pantalla que se parezca a un aviso, porque un
         * aviso escrito a mano es un hecho que no pasó.
         *
         * Y los cuatro estados se distinguen como en los saldos: no hay nada
         * (`empty`), no se pudo leer (`unavailable`), todavía se lee
         * (`idle`/`loading`) y hay (`ready`). "No hay noticias" y "no pudimos
         * leer las noticias" son hechos distintos y se ven distintos.
         */}
        {isNotificationsOpen && !notifications.signedOut && (
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
                <div className="flex items-center gap-1">
                  {/*
                   * Recargar a mano. No hay push: el feed se lee al abrir la app
                   * y cuando la persona lo pide. Sin este botón, un aviso nuevo
                   * sólo aparecería recargando la página entera.
                   */}
                  <button
                    onClick={notifications.reload}
                    type="button"
                    aria-label="Volver a leer tus notificaciones"
                    title="Actualizar"
                    disabled={notifications.status === 'loading'}
                    className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-black hover:bg-slate-200 transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        notifications.status === 'loading' ? 'animate-spin' : ''
                      }`}
                    />
                  </button>
                  <button
                    onClick={() => setIsNotificationsOpen(false)}
                    type="button"
                    aria-label="Cerrar notificaciones"
                    className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-black hover:bg-slate-200 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Leyendo: el mismo tratamiento neutro de la puerta de ingreso. */}
              {(notifications.status === 'idle' || notifications.status === 'loading') && (
                <div className="flex flex-col items-center justify-center gap-3 py-6 font-sans">
                  <Loader2 className="w-5 h-5 text-black animate-spin" />
                  <p className="text-xs font-medium text-slate-500">Cargando…</p>
                </div>
              )}

              {/*
               * NO SE PUDO LEER. Deliberadamente **no** es la lista vacía: acá
               * puede haber eventos que no llegamos a leer, y mostrar "no tenés
               * nada" sería afirmar lo contrario. Es el mismo ámbar de la nota de
               * saldo ilegible (`usdcNote`): una convención, no dos.
               */}
              {notifications.status === 'unavailable' && (
                <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-start gap-2.5">
                  <div className="w-5 h-5 shrink-0 mt-0.5 text-amber-600 font-black flex items-center justify-center text-[13px]">
                    !
                  </div>
                  <div>
                    <span className="font-bold text-amber-900 block">
                      No pudimos leer tus avisos
                    </span>
                    <span className="text-amber-700 text-[11px] leading-snug block mt-0.5">
                      {notifications.failureCode === NOTIFICATIONS_UNAVAILABLE_CODE
                        ? 'Los eventos de tu cuenta no se pudieron leer. No es que no haya pasado nada: probá de nuevo en un rato.'
                        : 'No pudimos conectarnos para leer los eventos de tu cuenta. Probá de nuevo en un rato.'}
                    </span>
                  </div>
                </div>
              )}

              {/* No hay eventos. Un hecho, dicho como un hecho. */}
              {notifications.status === 'empty' && (
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-2.5">
                  <div className="w-5 h-5 shrink-0 mt-0.5 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center">
                    <Bell className="w-3 h-3 stroke-[2.2]" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-700 block">Nada nuevo</span>
                    <span className="text-slate-400 text-[11px] leading-snug block mt-0.5">
                      Cuando algo pase en tu cuenta —que entres, que se cree una
                      billetera, que conectes un método de acceso— te avisamos acá.
                    </span>
                  </div>
                </div>
              )}

              {/* El feed, tal cual. */}
              {notifications.status === 'ready' && (
                <div className="space-y-2.5 text-xs max-h-[60vh] overflow-y-auto">
                  {notifications.notifications.map((item) => {
                    const treatment = treatmentFor(item.category);
                    const Icon = CATEGORY_ICONS[treatment.icon];
                    const when = relativeTimeLabel(item.createdAt);

                    return (
                      <div
                        key={item.id}
                        className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-2.5"
                      >
                        <div
                          className={`w-5 h-5 shrink-0 mt-0.5 rounded-full flex items-center justify-center ${treatment.badgeBg} ${treatment.badgeText}`}
                        >
                          <Icon className="w-3 h-3 stroke-[2.2]" />
                        </div>
                        <div className="min-w-0">
                          {/*
                           * `message` va **verbatim**. No se reescribe, no se
                           * resume, no se le agrega el `eventType`: la frase es del
                           * backend y acá sólo se la muestra.
                           */}
                          <span className="font-bold text-slate-700 block leading-snug">
                            {item.message}
                          </span>
                          <span className="text-slate-400 text-[11px] flex items-center gap-1.5 mt-0.5">
                            <span>{treatment.label}</span>
                            {/* Sin `createdAt` legible no hay hora: no se inventa. */}
                            {when !== null && (
                              <>
                                <span aria-hidden="true">&middot;</span>
                                <span>{when}</span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
