import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface BackButtonProps {
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
}

export const BackButton: React.FC<BackButtonProps> = ({
  onClick,
  ariaLabel = 'Volver atrás',
  className = '',
}) => {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-label={ariaLabel}
      className={`w-11 h-11 rounded-full bg-white flex items-center justify-center text-slate-800 shadow-2xs hover:bg-slate-50 active:scale-95 transition-all cursor-pointer border border-slate-200/60 shrink-0 ${className}`}
    >
      <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
    </button>
  );
};
