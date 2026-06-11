import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { QueryProvider } from '@/lib/query';

export const metadata: Metadata = {
  title: 'Forecast-Portal BU Brachytherapie',
  description: 'Budget / Forecast / Ist-Umsatz — Eckert & Ziegler',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="bg-gray-50 text-gray-900">
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
