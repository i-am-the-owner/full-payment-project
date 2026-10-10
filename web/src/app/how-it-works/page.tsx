import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { Steps } from "@/components/Steps";
import { Card, CardBody, CardTitle } from "@/components/Card";
import { ButtonLink } from "@/components/Button";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How sending money with AaminPay works, step by step: create an account, verify your identity when required, choose a destination and amount, review the rate and fees, confirm, and track your transfer.",
  alternates: { canonical: "/how-it-works" },
};

const steps = [
  {
    title: "Create your AaminPay account",
    body: "Sign up with your email address and choose a strong password. You'll verify your email before you can send money.",
  },
  {
    title: "Verify your identity when required",
    body: "Money-transfer services must carry out identity checks. AaminPay will ask you to verify your identity where the law and our checks require it — usually before your first transfer, and sometimes for larger amounts.",
  },
  {
    title: "Choose where you want to send money",
    body: "Pick the destination country. Our first corridor is the United Kingdom to Kenya; more are planned.",
  },
  {
    title: "Enter the amount",
    body: "Enter how much you want to send. AaminPay calculates a quote for you.",
  },
  {
    title: "Add recipient information",
    body: "Provide the recipient's details for the payout method you choose (for example a bank account or a mobile-money wallet).",
  },
  {
    title: "Review the exchange rate and fees",
    body: "AaminPay shows you the exchange rate, the transfer fee, and exactly how much the recipient will receive. The quote is valid for a limited time.",
  },
  {
    title: "Confirm the transfer",
    body: "When you're happy, confirm. AaminPay then processes the payout. Nothing about the price changes after you confirm.",
  },
  {
    title: "Track your transfer",
    body: "Follow the status of your transfer in the app — for example awaiting payment, processing, or completed — until the money reaches the recipient.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="How It Works"
        title="Sending money with AaminPay, step by step"
        lead="A clear, predictable process. You always see the full cost before you commit, and you can follow your transfer until it's done."
      />

      <Section containerSize="narrow">
        <Steps steps={steps} />
      </Section>

      <Section tone="muted" title="A few things to know" containerSize="narrow">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardTitle>Delivery times vary</CardTitle>
            <CardBody>
              Not every transfer is instant. How long a transfer takes depends
              on the destination, the payout method and the receiving bank.
              You’ll see an estimate before you confirm.
            </CardBody>
          </Card>
          <Card>
            <CardTitle>Quotes expire</CardTitle>
            <CardBody>
              Exchange rates move, so a quote is only held for a short time. If
              it expires before you confirm, you can request a fresh one.
            </CardBody>
          </Card>
          <Card>
            <CardTitle>The backend is the source of truth</CardTitle>
            <CardBody>
              The fee, the exchange rate and whether a transfer has completed
              are all decided by AaminPay’s servers. The app shows you that
              verified result.
            </CardBody>
          </Card>
          <Card>
            <CardTitle>If something goes wrong</CardTitle>
            <CardBody>
              If a transfer can’t be completed it’s marked as failed and the
              reason is recorded. Depending on the stage, funds are either not
              taken or are returned.
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section containerSize="narrow">
        <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white p-8 text-center shadow-[var(--shadow-card)]">
          <h2 className="text-2xl">Have a question first?</h2>
          <p className="mx-auto mt-2 max-w-md text-[var(--color-ink-soft)]">
            The FAQ covers fees, exchange rates, identity checks and tracking.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <ButtonLink href="/faq" variant="secondary">
              Read the FAQ
            </ButtonLink>
            <ButtonLink href="/contact" variant="ghost">
              Contact us
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
