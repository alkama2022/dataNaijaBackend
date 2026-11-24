const KYC_PROVIDER_BASE_URL = process.env.KYC_PROVIDER_BASE_URL ?? ''

/** True when a live KYC verification provider is configured. */
export function isKycProviderConfigured(): boolean {
  return KYC_PROVIDER_BASE_URL !== ''
}

export interface KycVerificationInput {
  type: 'BVN' | 'NIN'
  id: string
}

export interface KycVerificationResult {
  verified: boolean
  error?: string
}

/**
 * Asks the configured KYC provider to verify an identity number.
 *
 * Returns `verified: false` when no provider is configured or when the
 * provider did not confirm — the caller must not mark the account verified.
 */
export async function verifyKycIdentity(
  input: KycVerificationInput
): Promise<KycVerificationResult> {
  if (!isKycProviderConfigured()) {
    return { verified: false, error: 'KYC provider is not configured.' }
  }

  const response = await fetch(
    `${KYC_PROVIDER_BASE_URL.replace(/\/$/, '')}/verify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: input.type, id: input.id }),
    }
  )

  const body = (await response.json().catch(() => null)) as
    | { verified?: boolean; message?: string }
    | null
  if (!response.ok || body?.verified !== true) {
    return { verified: false, error: body?.message ?? 'KYC verification failed.' }
  }

  return { verified: true }
}
