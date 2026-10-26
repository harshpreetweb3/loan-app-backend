# Render test deployment

`render.yaml` deploys the `message-service` branch as two Render resources:

- `loan-app-api-test`: Express web service, with health check at `/health`.
- `loan-app-daily-due-reminders-test`: a daily Render Cron Job that runs at 12:05 AM Asia/Kolkata (`35 18 * * *` UTC).

Create a Blueprint from this repository and select the `message-service` branch. Render will prompt for all entries marked `sync: false`.

Set `FRONTEND_URL` to the Render static-site URL after the frontend is deployed. Set the same `MONGODB_URI` and WhatsApp variables on both the web service and Cron Job. The Cron Job needs only the WhatsApp sending variables; webhook credentials are needed only by the web service.

## Test safely

Use a separate MongoDB database and Meta test phone number/token for this Render deployment. Do not reuse the production Vercel `MONGODB_URI` or change the production Meta webhook callback URL: the Render Cron Job intentionally sends live reminder logic and could otherwise contact real borrowers. Point Meta's test app webhook to the Render API only after its `/health` endpoint is reachable.

Do not add a persistent disk for uploads: production uploads require Cloudinary and the service remains stateless.
