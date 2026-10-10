import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";

export default function NotFound() {
  return (
    <Container className="py-24 text-center">
      <p className="text-brand-600 text-sm font-semibold tracking-wide uppercase">
        404
      </p>
      <h1 className="mt-2 text-3xl">Page not found</h1>
      <p className="mx-auto mt-3 max-w-md text-[var(--color-ink-soft)]">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink href="/">Back to home</ButtonLink>
        <ButtonLink href="/faq" variant="secondary">
          Visit the FAQ
        </ButtonLink>
      </div>
    </Container>
  );
}
