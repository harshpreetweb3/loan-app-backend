# WhatsApp Cloud API setup

This backend sends borrower reminders through the official Meta WhatsApp Cloud API. Scheduled messages use approved Meta templates because those messages are initiated by the business outside WhatsApp's 24-hour customer-service window.

## 1. Configure Meta

In Meta for Developers, create or select a Business app with the WhatsApp product, add a sending phone number, and generate a long-lived system-user access token with permission to send WhatsApp messages. Create and get approval for these two templates:

- A due reminder template with four body variables: borrower name, installment number, due date, and amount.
- An overdue reminder template with the same four body variables.

Subscribe the app's WhatsApp webhook to message status updates. Use this callback URL:

```text
https://YOUR_BACKEND_DOMAIN/api/whatsapp/webhook
```

Choose a verify token yourself; it must match `META_WHATSAPP_VERIFY_TOKEN` below. Enable the `messages` webhook field.

## 2. Configure environment variables

Set these in local `.env` and in the Vercel backend project. Never commit their real values.

```text
META_WHATSAPP_ACCESS_TOKEN=long_lived_meta_access_token
META_WHATSAPP_PHONE_NUMBER_ID=meta_phone_number_id
META_WHATSAPP_API_VERSION=vXX.X
META_WHATSAPP_VERIFY_TOKEN=your_webhook_verify_token
META_WHATSAPP_APP_SECRET=meta_app_secret
WHATSAPP_TEMPLATE_LANGUAGE=en_US
WHATSAPP_DUE_REMINDER_TEMPLATE=your_approved_due_template_name
WHATSAPP_OVERDUE_REMINDER_TEMPLATE=your_approved_overdue_template_name
WHATSAPP_OVERDUE_REMINDER_INTERVAL_DAYS=3
```

Use the Graph API version supported by your Meta app for `META_WHATSAPP_API_VERSION`; keeping it explicit avoids unexpected behavior when Meta releases a new default version.

## 3. Obtain borrower consent

The API refuses to send to a borrower until an administrator records their opt-in:

```http
PATCH /api/whatsapp/borrowers/:borrowerId/opt-in
Authorization: Bearer <app JWT>
Content-Type: application/json

{ "optedIn": true }
```

Only collect consent through a compliant process and honor opt-outs immediately.

## Application endpoints

- `GET /api/whatsapp/status` — whether server-side Meta credentials are configured.
- `GET /api/whatsapp/messages?borrower=:borrowerId` — recent delivery log.
- `POST /api/whatsapp/borrowers/:borrowerId/template` — send an approved template. Supply `templateName`, optional `language`, and `bodyParameters`.
- `POST /api/whatsapp/borrowers/:borrowerId/text` — send a free-form message with `{ "body": "..." }`. Meta permits this only during the active customer-service window; otherwise use a template.
- `GET` and `POST /api/whatsapp/webhook` — Meta verification and signed delivery-status webhook.

The daily job sends a due reminder on the due date, then sends overdue reminders every `WHATSAPP_OVERDUE_REMINDER_INTERVAL_DAYS` days. Each scheduled message is recorded and deduplicated per installment and day.
