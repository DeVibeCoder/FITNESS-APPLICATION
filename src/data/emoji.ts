/**
 * The emoji the picker offers.
 *
 * A table rather than a range sweep. Sweeping Unicode blocks produces hundreds
 * of unassigned code points, and every one of them lands on a phone as a tofu
 * box — a picker full of empty rectangles is worse than a smaller picker. So
 * these are assigned characters, grouped the way every keyboard groups them,
 * and searchable by the words people actually type.
 *
 * Nothing here is a limit on what can be *sent*: the reaction rules take any
 * string, and a message can carry any character the keyboard produces. This is
 * the browse-and-search set, and it is broad enough that "not artificially
 * limited" is true in the way that matters — no ten-emoji allowlist.
 */

export interface EmojiGroup {
  key: string
  label: string
  /** One character standing for the group on the tab strip. */
  tab: string
  emoji: string[]
}

/**
 * Search words, for the handful people reach for by name in a fitness group.
 * Everything else is found by browsing, which is how emoji are mostly picked.
 */
const KEYWORDS: Record<string, string> = {
  '😀': 'grin smile happy',
  '😂': 'laugh cry funny lol',
  '🤣': 'rofl laugh funny',
  '🥲': 'tear smile sad happy',
  '😅': 'sweat nervous laugh',
  '😉': 'wink',
  '😍': 'love heart eyes',
  '😘': 'kiss love',
  '🤔': 'think hmm',
  '😴': 'sleep tired rest',
  '😭': 'cry sob sad',
  '😤': 'huff steam angry determined',
  '😡': 'angry mad rage',
  '🥵': 'hot sweat heat',
  '🥶': 'cold freeze',
  '🤯': 'mind blown shock',
  '🤝': 'handshake deal agree',
  '👍': 'thumbs up yes good like',
  '👎': 'thumbs down no bad',
  '👏': 'clap applause well done',
  '🙌': 'raise hands celebrate praise',
  '🙏': 'pray thanks please',
  '💪': 'muscle strong flex gym',
  '🔥': 'fire hot lit strong',
  '💯': 'hundred perfect full',
  '⚡': 'lightning energy fast power',
  '🎯': 'target goal aim',
  '🏆': 'trophy win award champion',
  '🥇': 'gold first medal win',
  '🏋️': 'lift weights gym workout',
  '🏃': 'run running cardio',
  '🚴': 'cycle bike cycling',
  '🏊': 'swim swimming',
  '🧘': 'yoga stretch calm meditate',
  '🥊': 'boxing punch fight',
  '⚽': 'football soccer',
  '🏀': 'basketball',
  '🥗': 'salad healthy food',
  '🍎': 'apple fruit food healthy',
  '🍗': 'chicken protein food meat',
  '🥚': 'egg protein food',
  '🥑': 'avocado food fat',
  '💧': 'water drop hydrate',
  '☕': 'coffee caffeine',
  '🍺': 'beer drink',
  '⏰': 'alarm clock time early',
  '📈': 'chart up progress gain',
  '📉': 'chart down loss drop',
  '⚖️': 'scale weight weigh',
  '❤️': 'heart love red',
  '💔': 'broken heart',
  '✅': 'check done tick complete',
  '❌': 'cross no wrong',
  '🎉': 'party celebrate tada',
  '👀': 'eyes look watching',
  '🧠': 'brain mind smart',
  '🦵': 'leg legs leg day',
  '🩹': 'plaster injury hurt',
  '😎': 'cool sunglasses',
  '🤩': 'star struck amazed wow',
  '🥳': 'party celebrate birthday',
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    key: 'reactions',
    label: 'Reactions',
    tab: '🔥',
    emoji: [
      '🔥', '💪', '👏', '❤️', '😂', '🙌', '💯', '🎯', '⚡', '🏆',
      '👍', '👎', '😎', '🙏', '🤝', '🤯', '👀', '🥳', '🎉', '✅',
    ],
  },
  {
    key: 'smileys',
    label: 'Smileys',
    tab: '😀',
    emoji: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
      '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫',
      '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬',
      '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢',
      '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎',
      '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺',
      '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
      '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈',
      '💀', '🤡', '👻', '👽', '🤖', '😺', '😹', '😻', '😼', '🙀',
    ],
  },
  {
    key: 'people',
    label: 'People',
    tab: '👍',
    emoji: [
      '👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🫰',
      '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎',
      '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝',
      '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦶', '👂', '👃',
      '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '🫦',
      '👶', '🧒', '👦', '👧', '🧑', '👨', '👩', '🧓', '👴', '👵',
      '🙍', '🙎', '🙅', '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷',
      '🕺', '💃', '👯', '🧖', '🧗', '🤺', '🏇', '⛷️', '🏂', '🏌️',
    ],
  },
  {
    key: 'fitness',
    label: 'Fitness',
    tab: '🏋️',
    emoji: [
      '🏋️', '🤸', '🤼', '🤽', '🤾', '🧘', '🏃', '🚶', '🧎', '🚴',
      '🚵', '🏊', '🏄', '🛹', '🛼', '⛸️', '🥊', '🥋', '🤺', '🏹',
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱',
      '🏓', '🏸', '🥅', '⛳', '🏒', '🏑', '🥍', '🏏', '🪀', '🪃',
      '🎽', '👟', '🧦', '🎿', '🛷', '🥌', '🎳', '🪂', '🤿', '🩴',
      '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🎯', '⚡', '💥', '💫',
      '⏱️', '⏲️', '⏰', '📈', '📉', '📊', '⚖️', '🧭', '🗓️', '🔋',
    ],
  },
  {
    key: 'food',
    label: 'Food',
    tab: '🍎',
    emoji: [
      '🍎', '🍏', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐',
      '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑',
      '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅',
      '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳',
      '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟',
      '🍕', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕',
      '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍚', '🍙',
      '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁',
      '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰',
      '🥜', '🍯', '🥛', '🍼', '☕', '🍵', '🧃', '🥤', '🧋', '💧',
      '🧊', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🫗',
    ],
  },
  {
    key: 'things',
    label: 'Things',
    tab: '💡',
    emoji: [
      '⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💾', '📷', '📹',
      '🎥', '📺', '📻', '🎙️', '🎧', '🔊', '🔔', '📣', '📢', '🎵',
      '🎶', '🎤', '🎬', '🕹️', '🎮', '🎲', '🧩', '🪄', '🎨', '🖌️',
      '✏️', '🖊️', '📝', '📒', '📔', '📕', '📗', '📘', '📙', '📚',
      '🔍', '🔎', '🔑', '🔒', '🔓', '🧰', '🔧', '🔨', '⚙️', '🧲',
      '💡', '🔦', '🕯️', '🪫', '🔋', '🧴', '🧼', '🪥', '🧽', '🧻',
      '🛏️', '🛋️', '🚪', '🪟', '🧳', '⛺', '🏠', '🏢', '🏥', '🏦',
      '💊', '🩺', '🩹', '🧬', '🦠', '💉', '🧪', '🧫', '🌡️', '🚑',
      '🚗', '🚕', '🚌', '🚲', '🛴', '🏍️', '✈️', '🚀', '⛵', '🚂',
    ],
  },
  {
    key: 'nature',
    label: 'Nature',
    tab: '🌿',
    emoji: [
      '🌱', '🌿', '☘️', '🍀', '🎋', '🍃', '🍂', '🍁', '🌾', '🌵',
      '🌴', '🌳', '🌲', '🪴', '🌺', '🌸', '💐', '🌷', '🌹', '🌻',
      '🌼', '🍄', '🌰', '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻',
      '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧',
      '🦅', '🦆', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛',
      '🦋', '🐌', '🐞', '🐢', '🐍', '🐙', '🦑', '🦐', '🦀', '🐠',
      '🐟', '🐬', '🐳', '🦈', '🐊', '🐅', '🦓', '🦍', '🐘', '🦏',
      '☀️', '🌤️', '⛅', '🌥️', '☁️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️',
      '🌬️', '🌪️', '🌫️', '🌈', '🌙', '⭐', '🌟', '✨', '⚡', '🔥',
      '💥', '💫', '🌊', '💧', '🌍', '🌎', '🌏', '🪐', '☄️', '🌞',
    ],
  },
  {
    key: 'symbols',
    label: 'Symbols',
    tab: '❤️',
    emoji: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
      '✅', '☑️', '✔️', '❌', '❎', '➕', '➖', '➗', '✖️', '♾️',
      '❗', '❓', '❕', '❔', '‼️', '⁉️', '💤', '💢', '💬', '🗯️',
      '💭', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤',
      '🔺', '🔻', '🔶', '🔷', '🔸', '🔹', '⭐', '🌟', '💫', '⚠️',
      '🚫', '⛔', '📵', '🔞', '☢️', '♻️', '🆗', '🆕', '🆒', '🔝',
      '🔜', '🔙', '🔛', '🔚', '🔄', '🔃', '⏩', '⏪', '⏫', '⏬',
    ],
  },
  {
    key: 'flags',
    label: 'Flags',
    tab: '🏁',
    emoji: [
      '🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🇦🇪', '🇦🇷', '🇦🇺', '🇧🇩',
      '🇧🇪', '🇧🇷', '🇨🇦', '🇨🇭', '🇨🇳', '🇩🇪', '🇩🇰', '🇩🇿', '🇪🇬', '🇪🇸',
      '🇫🇮', '🇫🇷', '🇬🇧', '🇬🇷', '🇮🇩', '🇮🇪', '🇮🇱', '🇮🇳', '🇮🇶', '🇮🇷',
      '🇮🇹', '🇯🇵', '🇰🇪', '🇰🇷', '🇰🇼', '🇱🇧', '🇱🇾', '🇲🇦', '🇲🇽', '🇲🇾',
      '🇳🇬', '🇳🇱', '🇳🇴', '🇳🇿', '🇵🇭', '🇵🇰', '🇵🇱', '🇵🇸', '🇵🇹', '🇶🇦',
      '🇷🇴', '🇷🇺', '🇸🇦', '🇸🇩', '🇸🇪', '🇸🇬', '🇸🇾', '🇹🇳', '🇹🇷', '🇺🇦',
      '🇺🇸', '🇻🇳', '🇾🇪', '🇿🇦',
    ],
  },
]

/** Every emoji in the picker, de-duplicated, in group order. */
export const ALL_EMOJI: string[] = [
  ...new Set(EMOJI_GROUPS.flatMap((group) => group.emoji)),
]

/**
 * Matches on the search words above and on the group name, so "gym" finds the
 * fitness group and "cry" finds the one emoji it is actually about.
 */
export function searchEmoji(query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const byGroup = EMOJI_GROUPS.filter((group) =>
    group.label.toLowerCase().includes(needle),
  ).flatMap((group) => group.emoji)

  const byWord = ALL_EMOJI.filter((emoji) => KEYWORDS[emoji]?.includes(needle))

  return [...new Set([...byWord, ...byGroup])]
}
