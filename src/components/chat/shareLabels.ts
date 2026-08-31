/**
 * What a share reads as when it is being referred to rather than drawn.
 *
 * Used by the quoted preview on a reply, by the pinned banner, and by the chat
 * list's last-message line — three places that need a phrase where the card
 * itself will not fit. It lives in its own module so both a component and a
 * page can import it without either of them exporting a non-component.
 */
export function sharedSummary(type?: string): string {
  switch (type) {
    case 'workout':
      return 'Shared a workout'
    case 'weigh_in':
      return 'Shared a weigh-in'
    case 'steps':
      return 'Shared their steps'
    case 'achievement':
      return 'Shared an achievement'
    case 'challenge':
      return 'Shared the challenge'
    default:
      return 'Message'
  }
}
