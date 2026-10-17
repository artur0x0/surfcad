import PrivacyChoicesController from './PrivacyChoicesController';

/**
 * Shared site footer for app and marketing surfaces.
 */
export default function SiteFooter({ variant = 'dark', children = null }) {
  const linkClass = variant === 'light'
    ? 'underline underline-offset-4 hover:text-[#16171D]'
    : 'text-[11px] text-gray-500 underline underline-offset-2 hover:text-gray-300';

  return (
    <footer
      className={
        variant === 'light'
          ? 'mt-12 flex flex-col items-center gap-3 text-center text-sm text-[#6B6E78]'
          : 'pointer-events-none fixed inset-x-0 bottom-0 z-[6] flex justify-center pb-[max(0.35rem,env(safe-area-inset-bottom))]'
      }
      data-site-footer=""
      data-site-footer-variant={variant}
    >
      {children}
      <div className={variant === 'light' ? '' : 'pointer-events-auto px-3 py-1'}>
        <PrivacyChoicesController linkClassName={linkClass} />
      </div>
    </footer>
  );
}
