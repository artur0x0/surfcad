import { BrandWordmark } from '../components/brand/BrandWordmark.jsx';
import SiteFooter from '../components/SiteFooter.jsx';

export default function NotFoundPage() {
  return (
    <div
      data-not-found-page=""
      className="surface-light text-on-light font-ui h-dvh overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-10 space-y-4">
          <BrandWordmark tone="splash" size={32} />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-not-found-title="">
            Page not found
          </h1>
          <p className="text-ui text-muted-on-light" data-not-found-lead="">
            That page does not exist.
          </p>
        </header>
        <SiteFooter variant="light">
          <a href="/" className="underline underline-offset-4" data-not-found-home="">
            Back to SurfCAD
          </a>
        </SiteFooter>
      </div>
    </div>
  );
}
