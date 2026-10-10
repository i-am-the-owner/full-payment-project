export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Answers are deliberately general. They must not assert regulatory status or
 * provider-specific details that have not been confirmed.
 */
export const faqs: FaqItem[] = [
  {
    question: "What is SomPay?",
    answer:
      "SomPay is a UK-based digital platform for sending money to people in other countries. You create an account, tell us where and how much you want to send, review the exchange rate and fees, and confirm. You can then track the transfer until it reaches the recipient.",
  },
  {
    question: "How does sending money work?",
    answer:
      "You choose a destination and amount, and SomPay shows you the exchange rate, the fee, and the amount your recipient will receive. You add the recipient's details, review everything, and confirm. SomPay then processes the payout to the recipient and keeps you updated on its status.",
  },
  {
    question: "What countries can I send money to?",
    answer:
      "Our first corridor is the United Kingdom to Kenya, and it is currently in development. We are designing SomPay to add more destinations over time. The Countries page lists each destination and its current status.",
  },
  {
    question: "How are fees calculated?",
    answer:
      "Each transfer has a transfer fee set by SomPay, plus the exchange rate applied to convert your money into the recipient's currency. Both are shown to you in full before you confirm — there is nothing hidden after confirmation. Specific pricing is not finalised yet; see the Fees page.",
  },
  {
    question: "How is the exchange rate determined?",
    answer:
      "The exchange rate is calculated by SomPay's backend at the time you request a transfer, based on current wholesale rates from our payout partner. The rate you see is the rate applied to your transfer for a limited time, after which you may need to request a fresh quote.",
  },
  {
    question: "Do I need to verify my identity?",
    answer:
      "Identity verification is required for money-transfer services. SomPay will ask you to verify your identity where the law and our checks require it, typically before your first transfer or when sending larger amounts.",
  },
  {
    question: "How can I track my transfer?",
    answer:
      "Every transfer has a status that is confirmed by SomPay's backend — for example awaiting payment, processing, or completed. You can see the current status in the app at any time. SomPay does not rely on the app's device to decide whether a transfer succeeded.",
  },
  {
    question: "What happens if my transfer fails?",
    answer:
      "If a transfer cannot be completed, it is marked as failed and the reason is recorded. Depending on the stage it failed at, funds are either not taken or are returned. You can contact support if you have questions about a specific transfer.",
  },
  {
    question: "How can I contact SomPay?",
    answer:
      "Use the Contact page to send us a message. Support and general-enquiry email addresses are listed there. These channels are being set up as we prepare for launch.",
  },
];
