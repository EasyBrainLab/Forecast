'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { user, laden } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (laden) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [user, laden, router]);
  return <main className="flex min-h-screen items-center justify-center text-gray-500">Lädt…</main>;
}
