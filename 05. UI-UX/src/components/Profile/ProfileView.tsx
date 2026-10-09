import React from 'react';
import {
  User,
  Mail,
  Phone,
  LogOut,
  Calendar,
  ChevronLeft,
} from 'lucide-react';
import { UserProfileData } from '../../types';

interface ProfileViewProps {
  profile: UserProfileData | null;
  onResetOnboarding: () => void;
  onClose?: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  profile,
  onResetOnboarding,
  onClose,
}) => {
  /*
   * ── POR QUÉ NO HAY NADA QUE VERIFICAR ACÁ ───────────────────────────────────
   *
   * Este Perfil tuvo durante un tiempo un modal de verificación de correo de 6
   * dígitos con su botón "Verificar". **Se borró**, y no porque quedara viejo:
   * porque contradecía el contrato.
   *
   * La verificación de correo **es la puerta de la app** (Hoja 4, 0.3): antes
   * de poner el código no se ve nada de ReWALLET. Un modal de verificación
   * adentro del Perfil solo puede abrirse con la app ya abierta, o sea que
   * aceptaba entrar sin código. Eso no era una función de más: era una puerta
   * trasera.
   *
   * Y una lista de verificaciones que no tiene nada que verificar no informa
   * nada: en este producto toda cuenta que existe ya verificó su correo al
   * entrar, y el teléfono no se verifica nunca (Hoja 4, 0.1). Por eso no queda
   * ni estado, ni handler, ni botón "Verificar", ni fila "Listo".
   *
   * El estado de la passkey tampoco vive acá: se crea en el onboarding y no hay
   * forma de consultarlo desde acá. Si alguna vez tiene que verse, va en una
   * decisión de producto aparte, no colgada de una lista que ya no existe.
   */

  const userTag = profile?.nombre
    ? '$' + profile.nombre.toLowerCase().replace(/\s+/g, '').slice(0, 10)
    : '$joadata';

  if (!profile) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[#f3f4f6]">
        {onClose && (
          <button
            onClick={onClose}
            type="button"
            className="absolute top-4 left-4 p-2 rounded-full bg-white text-black shadow-sm"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <div className="w-16 h-16 rounded-3xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shadow-sm mb-3">
          <User className="w-8 h-8" />
        </div>
        <h3 className="text-sm font-bold text-black font-display">Sin Perfil Configurado</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">
          Completa el onboarding para registrar tus datos.
        </p>
        <button
          onClick={onResetOnboarding}
          type="button"
          className="mt-4 px-5 py-2.5 rounded-full bg-black text-[#ccff00] font-bold text-xs active:scale-95 transition-transform"
        >
          Iniciar Onboarding
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto bg-[#f3f4f6] p-4 pb-24 max-w-md mx-auto space-y-4 select-none animate-in fade-in duration-200">
      {/* Barra de cabecera con botón de cierre */}
      {onClose && (
        <div className="flex items-center justify-between pb-1">
          <button
            onClick={onClose}
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-black text-xs font-bold border border-slate-200 shadow-2xs active:scale-95 transition-transform"
          >
            <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
            <span>Volver</span>
          </button>
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider font-display">
            Mi Perfil
          </span>
          <div className="w-8" />
        </div>
      )}

      {/* =========================================================================
          CABECERA DEL PERFIL:
          Foto de perfil, Nombre y Tag (CENTRADOS)
         ========================================================================= */}
      <div className="bg-white border border-slate-200/80 rounded-[32px] p-5 shadow-[0_4px_25px_rgba(0,0,0,0.04)] relative overflow-hidden">
        <div className="grid grid-cols-1 gap-4 items-center">
          {/* Foto de perfil, nombre y tag CENTRADOS */}
          <div className="flex flex-col items-center justify-center text-center space-y-2.5">
            <div className="w-16 h-16 rounded-2xl bg-black shadow-md flex items-center justify-center text-[#ccff00] font-extrabold text-2xl font-display shrink-0">
              {profile.nombre.charAt(0).toUpperCase()}
            </div>

            <div className="space-y-0.5">
              <h2 className="text-base font-bold font-display text-black tracking-tight leading-tight">
                {profile.nombre}
              </h2>
              <span className="text-xs font-bold text-slate-500 font-mono block">
                {userTag}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Mapeo Detallado de Datos del Onboarding */}
      <div className="bg-white border border-slate-200/80 rounded-[32px] p-5 shadow-[0_4px_25px_rgba(0,0,0,0.04)] space-y-3">
        <h3 className="text-xs font-bold text-black uppercase tracking-wider font-display">
          Datos de la Cuenta
        </h3>

        <div className="space-y-2.5 text-xs">
          {/* Nombre */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-600 shadow-2xs">
                <User className="w-4 h-4" />
              </div>
              <span className="text-slate-500 font-medium">Nombre</span>
            </div>
            <span className="text-black font-bold truncate max-w-[170px]">
              {profile.nombre}
            </span>
          </div>

          {/* Correo */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-600 shadow-2xs">
                <Mail className="w-4 h-4" />
              </div>
              <span className="text-slate-500 font-medium">Correo</span>
            </div>
            <span className="text-black font-semibold truncate max-w-[170px]">
              {profile.correo}
            </span>
          </div>

          {/* Teléfono */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-600 shadow-2xs">
                <Phone className="w-4 h-4" />
              </div>
              <span className="text-slate-500 font-medium">Teléfono</span>
            </div>
            <span className="text-black font-semibold">
              {profile.telefono}
            </span>
          </div>

          {/* Registro (Puesto abajo de Teléfono) */}
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-600 shadow-2xs">
                <Calendar className="w-4 h-4" />
              </div>
              <span className="text-slate-500 font-medium">Registro</span>
            </div>
            <span className="text-black font-semibold">
              {profile.registradoEn}
            </span>
          </div>
        </div>
      </div>

      {/* BOTÓN CERRAR SESIÓN EN ROJO */}
      <div className="pt-1">
        <button
          onClick={onResetOnboarding}
          type="button"
          className="w-full min-h-[48px] px-4 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-2xs active:scale-98 cursor-pointer"
        >
          <LogOut className="w-4 h-4 text-rose-600" />
          <span>CERRAR SESIÓN</span>
        </button>
      </div>
    </div>
  );
};
