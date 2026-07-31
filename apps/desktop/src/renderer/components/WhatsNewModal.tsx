import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench, Puzzle, MessageCircle, AlertCircle, type LucideIcon } from 'lucide-react'
import { Modal } from './ui/modal'
import { useWhatsNewStore } from '../stores/whatsNewStore'
import { BrandLobster } from './ui/brand-lobster'


// ── Release highlights ──────────────────────────────────────────────
// Editorial content, updated once per release (this is the only place
// to touch). Keep it to 2-4 entries; every entry must describe a change
// the user can actually see or feel, written from their side of the
// screen — no internals, no version plumbing.
const RELEASE_HIGHLIGHTS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Wrench,
    title: 'Updates that fix themselves',
    body: 'This release moves your saved sign-ins to a new format. The app now handles that for you on launch, so your assistant starts up as usual instead of stalling after an update.',
  },
  {
    icon: Puzzle,
    title: 'Your plugin choices stick',
    body: 'Turn a plugin off and it stays off. Enabled and disabled plugins now survive restarts and updates instead of quietly switching back on.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp sign-in survives a retry',
    body: 'If the QR code times out, hitting retry now brings up a fresh one — it used to fail with an empty screen and no explanation.',
  },
  {
    icon: AlertCircle,
    title: 'No more buttons that do nothing',
    body: 'Skills and Automations now tell you when something goes wrong, so a failed switch or delete says why instead of silently snapping back.',
  },
]

/**
 * One-time "What's new" dialog shown on the first launch after an
 * update (never on fresh installs — onboarding owns that moment).
 * Reopens any time from the version badge in the sidebar footer.
 */
export function WhatsNewModal() {
  const { t } = useTranslation()
  const { open, version, init, dismiss } = useWhatsNewStore()

  useEffect(() => {
    void init()
  }, [init])

  return (
    <Modal
      open={open}
      onClose={dismiss}
      maxWidthClass="max-w-lg"
      labelledBy="whats-new-title"
      padded={false}
    >
      {/* Header band — quiet coral wash, lobster, version. */}
      <div className="px-7 pt-7 pb-5 rounded-t-2xl bg-gradient-to-b from-brand-400/[0.08] to-transparent">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-500 dark:text-brand-400">
          <BrandLobster size={16} className="shrink-0" />
          {t('whatsNew.eyebrow', "What's new")}
        </div>
        <h2 id="whats-new-title" className="mt-2 font-display text-2xl font-bold tracking-tight">
          {t('whatsNew.title', 'Openclaw Easy')}{' '}
          <span className="text-muted-foreground font-medium">{version}</span>
        </h2>
      </div>

      {/* Highlights. */}
      <ul className="px-7 pb-2 space-y-4">
        {RELEASE_HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex items-start gap-3.5">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-400/10 text-brand-500 dark:text-brand-400">
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-[15px] leading-snug">{title}</div>
              <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">{body}</p>
            </div>
          </li>
        ))}
      </ul>

      {/* Single CTA — dismisses and records the version. */}
      <div className="px-7 pb-7 pt-4">
        <button
          onClick={dismiss}
          className="press-pulse w-full rounded-xl bg-primary text-primary-foreground py-2.5 text-[15px] font-semibold transition-[filter] hover:brightness-105 active:brightness-95"
        >
          {t('whatsNew.continue', 'Continue')}
        </button>
      </div>
    </Modal>
  )
}
