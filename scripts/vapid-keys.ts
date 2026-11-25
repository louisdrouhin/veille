/**
 * Prints a new VAPID key pair for the server .env (push notifications of Ma stack):
 *   docker compose run --rm --no-deps app node dist/vapid-keys.js
 * Nothing is stored: copy the two lines into .env, then `docker compose up -d`.
 */
import { generateVapidKeys } from "@/lib/push/webpush";

const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
