import React from 'react';
import { cn } from './utils.js';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'flat' | 'suggested' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  /** Mostra solo l'icona mantenendo dimensioni quadrate. */
  iconOnly?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'default',
  size = 'md',
  icon,
  iconOnly = false,
  className,
  disabled,
  ...props
}) => {
  const base =
    'inline-flex items-center justify-center font-medium rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--adw-focus-ring)] disabled:opacity-40 disabled:cursor-not-allowed select-none';

  const sizes = {
    sm: iconOnly ? 'h-7 w-7' : 'h-7 px-2.5 gap-1.5 text-xs',
    md: iconOnly ? 'h-8 w-8' : 'h-8 px-3 gap-1.5 text-[13px]',
    lg: iconOnly ? 'h-9 w-9' : 'h-9 px-4 gap-2 text-sm',
  };

  const variants = {
    default:
      'bg-[var(--adw-card-bg)] text-[var(--adw-fg-color)] border border-[var(--adw-card-border)] hover:bg-[var(--adw-button-hover)] shadow-[var(--adw-shadow-sm)]',
    flat: 'bg-transparent text-[var(--adw-fg-color)] hover:bg-[var(--adw-button-hover)]',
    suggested:
      'bg-[var(--adw-accent-color)] text-white hover:bg-[var(--adw-accent-hover)] active:bg-[var(--adw-accent-active)] shadow-[var(--adw-shadow-sm)]',
    destructive:
      'bg-[var(--adw-destructive-color)] text-white hover:opacity-90',
  };

  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      {!iconOnly && children && <span className="truncate">{children}</span>}
    </button>
  );
};
