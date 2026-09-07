/**
 * The approval queue, as the server sees it.
 *
 * This is the one part of the application that deliberately does not read
 * through the local cache. An approval decides who may sign in, and the only
 * copy of that answer which matters is the server's — a queue drawn from
 * whatever this browser happens to have stored would show accounts that were
 * decided on another device an hour ago, and hide accounts it has never heard
 * of. So it asks every time.
 *
 * Nothing here is trusted for authorisation. The screen behind it checks the
 * role to decide what to draw, and the routes underneath check it again on
 * every request; if the two ever disagree, the server wins and the screen
 * simply shows an error.
 */
import { cloudDataService, CloudDataError } from './cloudDataService'

export interface AccountRow {
  id: string
  name: string
  handle: string | null
  email: string | null
  role: string
  status: string
  decided_at: string | null
  decided_by: string | null
  created_at: string
}

export type Decision = 'approved' | 'rejected' | 'disabled'

const BASE = '/api/admin'

export const adminService = {
  /**
   * Accounts waiting on a decision, and how many there are.
   *
   * Returns an empty queue rather than throwing when there is no backend or
   * the caller turns out not to be an administrator: the screen has a role
   * check of its own, and an error page for "you are not an admin" would be
   * telling somebody something they already know.
   */
  async queue(status: string | null = 'pending'): Promise<{ accounts: AccountRow[]; pending: number }> {
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : ''
      return await cloudDataService.get<{ accounts: AccountRow[]; pending: number }>(
        `${BASE}/accounts${query}`,
        { base: '' },
      )
    } catch (error) {
      if (error instanceof CloudDataError) return { accounts: [], pending: 0 }
      throw error
    }
  },

  /**
   * Records a decision. The acting administrator is the session, so there is
   * no field here for whose decision it is.
   */
  async decide(userId: string, status: Decision): Promise<void> {
    await cloudDataService.post(`${BASE}/accounts`, { userId, status }, { base: '' })
  },
}
