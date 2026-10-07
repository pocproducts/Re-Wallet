import React from 'react';

export type StatusBadgeVariant = 'live' | 'lime' | 'subtle' | 'neutral';

interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
  showDot?: boolean;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  variant = 'subtle',
  showDot = false,
  className = '',
}) => {
  const variantStyles: Record<StatusBadgeVariant, string> = {
    live: 'bg-emerald-50 text-emerald-600 border border-emerald-200/50',
    lime: 'bg-[#ccff00] text-black font-extrabold',
    subtle: 'bg-[#f4f7fa] text-slate-700',
    neutral: 'bg-slate-100 text-slate-600',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide ${variantStyles[variant]} ${className}`}
    >
      {showDot && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
      <span>{label}</span>
    </span>
  );
};
