import { prisma } from '@/lib/prisma'

/**
 * Admin settings.
 *
 * The referral commission rules and the routing weights are things the
 * admin changes, so they live in the database as key/value rows. Every
 * setting has a default, so a fresh database behaves sensibly without a
 * seed.
 */

export const SETTING_DEFAULTS = {
  // Referral program
  'referral.enabled': '1',
  'referral.firstBonus': '100',
  'referral.commissionPct': '20',
  'referral.monthlyCap': '5000',
  'referral.minToWithdraw': '100',
  'referral.lifetime': 'Lifetime',
  'referral.whoCanEarn': 'Everyone',

  // Smart routing
  'routing.mode': 'smart',
  'routing.weight.price': '40',
  'routing.weight.reliability': '30',
  'routing.weight.fault': '20',
  'routing.weight.availability': '10',
} as const

export type SettingKey = keyof typeof SETTING_DEFAULTS

export type AdminSettings = Record<SettingKey, string>

/** All settings, with the defaults filled in for anything not saved yet. */
export async function getSettings(): Promise<AdminSettings> {
  const rows = await prisma.setting.findMany()
  const saved = Object.fromEntries(rows.map((row) => [row.key, row.value]))

  const settings = { ...SETTING_DEFAULTS } as AdminSettings
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    if (saved[key] !== undefined) settings[key] = saved[key]
  }
  return settings
}

/**
 * Saves the settings that changed.
 *
 * Only the keys that were given are written, so a partial form never
 * resets the settings it does not touch.
 */
export async function saveSettings(values: Partial<Record<SettingKey, string>>) {
  const entries = Object.entries(values).filter(
    (entry): entry is [SettingKey, string] => entry[1] !== undefined
  )
  if (entries.length === 0) return

  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    )
  )
}

/** A setting as a number, falling back to the default. */
export function settingNumber(
  settings: AdminSettings,
  key: SettingKey,
  fallback = 0
): number {
  const value = Number(settings[key])
  return Number.isFinite(value) ? value : fallback
}

/** A setting as a boolean. `1` and `true` are true. */
export function settingFlag(settings: AdminSettings, key: SettingKey): boolean {
  const value = settings[key]
  return value === '1' || value === 'true'
}
