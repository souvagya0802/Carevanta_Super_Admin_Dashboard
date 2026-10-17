'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PROVIDER_TYPES, slugForType, type ProviderType } from '@/lib/providers-meta';
import { ProviderCreateDialog } from '@/components/providers/provider-create-dialog';
import { RequirePermission } from '@/components/layout/shell';

/** Deep link that opens the registration modal over the matching list. */
function NewProviderInner() {
  const params = useSearchParams();
  const router = useRouter();
  const type = (PROVIDER_TYPES as readonly string[]).includes(params.get('type') ?? '') ? (params.get('type') as ProviderType) : 'HOSPITAL';
  return <ProviderCreateDialog open initialType={type} onClose={() => router.replace(`/providers/${slugForType(type)}`)} />;
}

export default function NewProviderPage() {
  return (
    <RequirePermission anyOf={['providers.create']}>
      <Suspense fallback={null}><NewProviderInner /></Suspense>
    </RequirePermission>
  );
}
