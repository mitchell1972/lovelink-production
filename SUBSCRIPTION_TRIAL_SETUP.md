# Seven-day subscription trial setup

LoveLink now locks its core features until a user starts an active auto-renewing subscription. The first seven days must be supplied by the store as a free introductory offer; client-side app code cannot safely defer a store charge.

## App Store Connect

For both `com.lovelinkcouples.premium.monthly` and `com.lovelinkcouples.premium.yearly` in the same subscription group:

1. Open **Introductory Offers** and create an offer.
2. Set it to **Free** for **1 week**.
3. Keep the normal monthly or yearly renewal price on the subscription.
4. Submit the change and test it with a brand-new Sandbox tester.

Apple determines introductory-offer eligibility. A customer who has already used an offer in that subscription group may be ineligible; the app refuses a paid purchase instead of silently charging them.

## Google Play Console

For each matching subscription/base plan:

1. Create an offer with a first pricing phase of a **free trial** for exactly **7 days** (`P7D`) at zero price.
2. Follow it with the normal recurring monthly or yearly price.
3. Activate the offer in every target country and add a license tester.

The app selects only an eligible Play offer whose first pricing phase is a zero-price seven-day trial. It does not use the first returned offer blindly.

## Verify before release

1. Test a new iOS Sandbox account: its payment sheet must show a seven-day trial and no charge today.
2. Test a new Play license tester: its payment sheet must show a zero-price seven-day phase before the paid renewal phase.
3. Cancel during the trial in both stores and verify access ends after the trial.
4. Test a renewal and a restore. Do not ship until server-side receipt validation is in place: the current Supabase RPC records client-supplied transaction data and cannot independently prove entitlement or renewal state.
