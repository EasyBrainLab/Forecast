import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { AuthProvider } from '@/lib/auth';
import { QueryProvider } from '@/lib/query';

export const metadata: Metadata = {
  title: 'Forecast-Portal BU Brachytherapie',
  description: 'Budget / Forecast / Ist-Umsatz — Eckert & Ziegler',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body className="bg-gray-50 text-gray-900">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QueryProvider>
            <AuthProvider>{children}</AuthProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
