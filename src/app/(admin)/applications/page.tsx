'use client';

import { CaseQueue } from '@/components/verification/case-queue';

export default function ApplicationsPage() {
  return <CaseQueue defaultView="open" permission="providers.read" heading="Provider Applications" description="Every provider submitted for verification. Each required check must pass, or be waived with a reason, before a different user can approve." />;
}
