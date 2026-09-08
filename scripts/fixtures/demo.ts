/**
 * The password the fixture accounts are given.
 *
 * This is not a credential to anything. It exists so `verify-data` can drive
 * the local sign-in path the same way a person would, against three invented
 * people in an in-memory IndexedDB that lasts as long as the process.
 *
 * It used to live in `src/data`, where the sign-in screen printed it — which
 * is exactly how a published bundle ends up carrying a password. See the
 * README beside this file for why the directory, rather than a flag, is now
 * what keeps it out of the application.
 */
export const DEMO_PASSWORD = 'circuit2026'

export const DEMO_HANDLES = ['ahmed', 'nadia', 'samir'] as const
