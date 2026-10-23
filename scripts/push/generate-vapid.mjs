#!/usr/bin/env node
// Prints a new VAPID key pair. Writes no files. Run: node scripts/push/generate-vapid.mjs
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`Paste these into Vercel (Project > Settings > Environment Variables), then redeploy.
Do NOT commit them and do NOT prefix them with NEXT_PUBLIC_.

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com   (use a real address you read)

Keep the private key secret. Changing the pair later invalidates every existing subscription.`);
