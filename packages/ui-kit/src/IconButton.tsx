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
  const base =
    'inline-flex items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--adw-focus-ring)] disabled:opacity-35 disabled:cursor-not-allowed select-none';

  const sizes = {
    sm: 'h-7 w-7',
    md: 'h-8 w-8',
    lg: 'h-9 w-9',
  };

  const variants = {
    default:
      'bg-[var(--adw-card-bg)] border border-[var(--adw-card-border)] text-[var(--adw-fg-color)] hover:bg-[var(--adw-button-hover)]',
    flat: 'bg-transparent text-[var(--adw-muted-color)] hover:bg-[var(--adw-button-hover)] hover:text-[var(--adw-fg-color)]',
    suggested:
      'bg-[var(--adw-accent-color)] text-white hover:bg-[var(--adw-accent-hover)]',
    destructive:
      'bg-transparent text-[var(--adw-destructive-color)] hover:bg-[color-mix(in_srgb,var(--adw-destructive-color)_12%,transparent)]',
  };

  return (
    <button
      className={cn(base, sizes[size], variants[variant], active && 'bg-[var(--adw-accent-soft)] text-[var(--adw-accent-color)]', className)}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
