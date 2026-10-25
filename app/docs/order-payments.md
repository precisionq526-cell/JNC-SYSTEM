# Customer order payments

Payment at pickup is available by default. Online wallets stay unavailable until the shop supplies a verified account name and number. No account from a design screenshot is used as payment information.

To enable a wallet, configure both corresponding server environment variables in `.env.local`, then rebuild/restart the app:

```dotenv
PAYMENT_GCASH_NAME=
PAYMENT_GCASH_NUMBER=
PAYMENT_MAYA_NAME=
PAYMENT_MAYA_NUMBER=
```

Names must be nonempty. Numbers must be Philippine mobile numbers in `09XXXXXXXXX` or `+639XXXXXXXXX` form. Only the configured account name and number are sent to the customer screen; no environment secrets are exposed.

The customer chooses a method on the confirmation screen. Online payments require a 6–80 character reference and a PDF/JPG/PNG/WEBP receipt up to 10 MB. Order files plus the receipt must fit within the existing 200 MB total. Receipts are staged separately in the browser, uploaded to `order-files/<order-id>/payment/<sha256>.<extension>`, and referenced in the order's structured `customer_notes` record. They are not added to `order_files` and cannot accidentally enter the print job.

The existing atomic order-submission function commits the payment information with the order and queue entry. New orders remain unpaid. Wallet receipts are recorded as pending verification. Upload paths are deterministic, and retrying the same submission returns the existing order without another queue entry.

Staff open an order in the admin UI, review its reference and receipt, confirm actual receipt of funds, and select **Confirm payment received**. The server requires administrator access, verifies that the receipt belongs to the order and remains available, then records `is_paid=true` and the payment method. Receipt downloads also require administrator access. This is a manual wallet-transfer verification workflow; it does not charge a wallet or claim an automatic gateway integration.

Customer tracking and tickets refresh the recorded paid status. Scheduled pickups are validated in Asia/Manila time, Monday–Saturday, 8:00 AM–6:00 PM, in both the customer interface and submission endpoint.

`node --test scripts/order-payment.test.mjs` checks this behavior with isolated fixtures. It does not create live orders or send money.
