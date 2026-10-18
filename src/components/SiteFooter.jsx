import PrivacyChoicesController from './PrivacyChoicesController';

/**
 * Footer for public pages (privacy, partners, admin, 404).
 * The CAD viewer mounts the default variant and gets no footer: the viewer
 * Privacy choices link is not shown on desktop or mobile.
 */
export default function SiteFooter({ variant = 'dark', children = null }) {
  if (variant !== 'light') return null;

  return (
    <footer
      className="mt-12 flex flex-col items-center gap-3 text-center text-sm text-muted-on-light"
      data-site-footer=""
      data-site-footer-variant="light"
    >
      {children}
      <PrivacyChoicesController linkClassName="underline underline-offset-4 hover:text-on-light" />
    </footer>
  );
}
