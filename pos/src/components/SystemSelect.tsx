import React from 'react';
import { ChevronDown } from 'lucide-react';

interface SystemSelectOption<T extends string> {
  value: T;
  label: string;
}

interface SystemSelectProps<T extends string> {
  value: T;
  options: Array<SystemSelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function SystemSelect<T extends string>({ value, options, onChange, disabled = false, className = '', ariaLabel }: SystemSelectProps<T>) {
  return (
    <label className={`relative block ${className}`}>
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-full w-full appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-xs font-bold text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-950"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    </label>
  );
}
