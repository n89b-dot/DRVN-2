/**
 * The 18+ confirmation (R69-age): one question, asked the same way wherever
 * an account starts — email sign-up, onboarding after a first Google sign-in,
 * and guest checkout before the order email goes out.
 *
 * Only the answer and when it was given are kept (public.age_confirmations,
 * 20261107231001). A date of birth is never asked for or stored.
 *
 * Shared by the forms (the box) and the server actions (the check), so the
 * field name and the wording can't drift apart. The server is the authority:
 * a form submitted without the box ticked is refused by the action, and a
 * handle can't be set through the API without the server's record.
 */

/** The checkbox's form field. */
export const AGE_CONFIRMATION_FIELD = "age_confirmed";
/** The value the box submits when ticked. */
export const AGE_CONFIRMATION_VALUE = "yes";

export const AGE_CONFIRMATION_LABEL = "I'm 18 or over";
export const AGE_CONFIRMATION_HINT = "DRVN is for adults. We only keep that you confirmed, never your date of birth.";
export const AGE_CONFIRMATION_REQUIRED = "Confirm you're 18 or over to continue.";

/** Where the confirmation was given (the table's `source`). */
export type AgeConfirmationSource = "email_signup" | "onboarding" | "guest_checkout";

/** True only when the box was ticked: absent, empty or any other value is no. */
export function ageConfirmedIn(formData: FormData): boolean {
  return formData.get(AGE_CONFIRMATION_FIELD) === AGE_CONFIRMATION_VALUE;
}
