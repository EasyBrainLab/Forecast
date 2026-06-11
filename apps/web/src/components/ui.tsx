'use client';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Button({ className, variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-ez-primary text-white hover:opacity-90',
    ghost: 'bg-white border border-gray-300 hover:bg-gray-50',
    danger: 'bg-ez-accent text-white hover:opacity-90',
  };
  return <button className={cn('rounded px-4 py-2 text-sm font-medium disabled:opacity-50 transition', styles[variant], className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-ez-primary focus:outline-none', className)} {...props} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-gray-200 bg-white p-5 shadow-sm', className)}>{children}</div>;
}

export function Ampel({ farbe }: { farbe: 'gruen' | 'gelb' | 'rot' | 'grau' }) {
  const map = { gruen: 'bg-ez-ampelGruen', gelb: 'bg-ez-ampelGelb', rot: 'bg-ez-ampelRot', grau: 'bg-gray-300' };
  return <span className={cn('inline-block h-3 w-3 rounded-full', map[farbe])} />;
}

export function keur(eur: number): string {
  return (eur / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
export function prozent(p: number | null): string {
  return p === null ? '—' : `${p.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}
