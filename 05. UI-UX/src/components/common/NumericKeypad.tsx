import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface NumericKeypadProps {
  onKeyPress: (key: string) => void;
  className?: string;
}

export const NumericKeypad: React.FC<NumericKeypadProps> = ({
  onKeyPress,
  className = '',
}) => {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'backspace'];

  return (
    <div className={`grid grid-cols-3 gap-y-3 gap-x-6 text-center select-none ${className}`}>
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onKeyPress(k)}
          className="h-11 flex items-center justify-center font-display text-2xl font-medium text-black active:opacity-40 active:scale-95 transition-all cursor-pointer"
        >
          {k === 'backspace' ? <ArrowLeft className="w-6 h-6 stroke-[2.2]" /> : k}
        </button>
      ))}
    </div>
  );
};
