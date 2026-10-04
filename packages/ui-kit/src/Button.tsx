import React from 'react';
import { cn } from './utils.js';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'flat' | 'suggested' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'default',
  size = 'md',
  icon,
  className,
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-[var(--adw-focus-ring)] disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]';

  const sizeStyles = {
    sm: 'text-xs px-2.5 py-1 gap-1.5 h-7',
    md: 'text-sm px-3.5 py-1.5 gap-2 h-8',
    lg: 'text-base px-4 py-2 gap-2.5 h-10',
  };

  const variantStyles = {
    default:
      'bg-[rgba(0,0,0,0.05)] dark:bg-[rgba(255,255,255,0.08)] text-[var(--adw-fg-color)] hover:bg-[rgba(0,0,0,0.1)] dark:hover:bg-[rgba(255,255,255,0.14)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)] shadow-sm',
    flat:
      'bg-transparent text-[var(--adw-fg-color)] hover:bg-[rgba(0,0,0,0.06)] dark:hover:bg-[rgba(255,255,255,0.08)]',
    suggested:
      'bg-[var(--adw-accent-color)] text-white hover:bg-[var(--adw-accent-hover)] active:bg-[var(--adw-accent-active)] shadow-sm',
    destructive:
      'bg-[var(--adw-destructive-color)] text-white hover:opacity-90 shadow-sm',
  };

  return (
    <button
      className={cn(baseStyles, sizeStyles[size], variantStyles[variant], className)}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
};
