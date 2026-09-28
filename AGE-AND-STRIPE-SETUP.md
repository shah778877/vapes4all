# Age verification and secure payment setup

This is a **prepared integration**. It is on a review branch and is not active on the live site. Do not activate payments or submit a checkout-age-verification screenshot until the actual Yoti service is connected and tested.

## Customer flow

Basket → verify 18+ through Yoti (ID document or verified digital ID) → server checks Yoti's completed result → Stripe-hosted Checkout → payment status verified on return. A self-declared 18+ homepage popup remains separate from the checkout age check.

The checkout server accepts only the flavours and prices currently in the site, recomputes Dojo offers, and calculates free DPD delivery above £23. Stripe's eligible methods come from the account settings; Klarna must be approved separately for vape sales.

## What the shop owner needs

1. Apply for a [Yoti Age Verification](https://www.yoti.com/business/age-verification/) account and ask them to enable **Doc Scan and Digital ID** for the shop. Obtain the Yoti **SDK ID** and **API key**. Ask Yoti about the cost and any age checking requirements for online nicotine products.
2. Complete Stripe's additional details honestly, naming vaping products. Stripe lists e-cigarettes as a **restricted business** requiring review. Klarna also lists e-cigarettes as restricted. Wait for approval for both card processing and Klarna before advertising them.
3. Choose the DPD delivery charge for orders with a discounted products total below £23. The Worker expects this as an integer number of pence.
4. Deploy `stripe-worker.js` as a Cloudflare Worker on an HTTPS subdomain such as `api.vapes4all.co.uk`. Configure the DNS and Worker custom domain so the browser accepts the age session cookie. A `workers.dev` address is not a tested replacement for the custom domain.
5. Put these variables in the Worker settings, **never in GitHub Pages or the public HTML**: `YOTI_API_KEY` (secret), `YOTI_SDK_ID`, `AGE_COOKIE_SECRET` (secret, long random string), `STRIPE_SECRET_KEY` (secret, test key initially), and `PAID_SHIPPING_PENCE` (for example `399` means £3.99). The Worker does not begin a payment if any necessary setting is missing.
6. Set `paymentsApi` near the top of the script in `checkout.html` to the full origin of the deployed Worker, for example `https://api.vapes4all.co.uk`. Start with Stripe test mode. Test a verified adult and a failed age check, a cancelled payment, shipping below and above £23, mix and match discounts, and the payment appearing in Stripe Dashboard.
7. Set up order handling in the Stripe Dashboard and arrange adult age checking at delivery as needed. The prepared code takes payment and confirms status, but has **no automated dispatch, stock control, webhook fulfilment, or customer order email of its own**. Check the Stripe payment record before dispatch. Consider adding a signed webhook and order store before scale.
8. Once live and verified, capture a **real screenshot of the age verification prompt in the checkout flow** and submit that to Stripe. Do not use a mockup as evidence.

The first screenshot for Stripe's optional homepage age-gating field is provided separately.

## Payment method activation

In [Stripe's payment method settings](https://dashboard.stripe.com/settings/payment_methods), choose the relevant business and enable card payments. Ask Stripe whether Klarna is approved for this vape business. If approved, enable Klarna there. Stripe's hosted Checkout presents each eligible enabled payment option based on transaction details; the code does not force or advertise Klarna where it is unavailable.

## Technical note

Yoti's API session is created by the Worker, which sets a short-lived signed, HttpOnly cookie. Only the Worker can query the Yoti result. A completed 18+ Doc Scan or Digital ID result tied to the same session is required on the server before it creates a Stripe Checkout Session. The basket's client-provided prices are ignored.
