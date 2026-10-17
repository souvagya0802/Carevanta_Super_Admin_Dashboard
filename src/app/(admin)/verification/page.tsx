'use client';

import { CaseQueue } from '@/components/verification/case-queue';

export default function VerificationPage() {
  return <CaseQueue defaultView="mine" permission="providers.verify" heading="Credential Verification" description="Work the checks on your cases. Every check records how it was verified, against which registry, and with what evidence." />;
}
