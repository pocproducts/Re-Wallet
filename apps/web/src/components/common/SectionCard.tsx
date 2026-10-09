import React from 'react';

interface SectionCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  children,
  className = '',
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-[28px] p-5 shadow-xs border border-slate-100 ${
        onClick ? 'cursor-pointer active:scale-99 transition-all' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
};
