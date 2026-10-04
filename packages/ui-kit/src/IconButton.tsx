import React from 'react';
import { cn } from './utils.js';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'flat' | 'suggested' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({
  children,
  variant = 'flat',
  size = 'md',
  active = false,
  className,
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)] disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-95';

  const sizeStyles = {
    sm: 'w-7 h-7 p-1',
    md: 'w-8 h-8 p-1.5',
    lg: 'w-10 h-10 p-2',
  };

  const variantStyles = {
    default:
      'bg-[rgba(0,0,0,0.05)] dark:bg-[rgba(255,255,255,0.08)] text-[var(--adw-fg-color)] hover:bg-[rgba(0,0,0,0.1)] dark:hover:bg-[rgba(255,255,255,0.14)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]',
    flat:
      'bg-transparent text-[var(--adw-fg-color)] hover:bg-[rgba(0,0,0,0.06)] dark:hover:bg-[rgba(255,255,255,0.08)]',
    suggested:
      'bg-[var(--adw-accent-color)] text-white hover:bg-[var(--adw-accent-hover)]',
    destructive:
      'bg-[var(--adw-destructive-color)] text-white hover:opacity-90',
  };

  const activeStyles = active
    ? 'bg-[var(--adw-accent-color)]/15 text-[var(--adw-accent-color)] font-semibold'
    : '';

  return (
    <button
      className={cn(baseStyles, sizeStyles[size], variantStyles[variant], activeStyles, className)}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
