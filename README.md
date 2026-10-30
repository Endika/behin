# behin

One-time secret notes. _Behin_ is Basque for "once".

**Use it:** https://endika.github.io/behin/

1. Write the note, choose how long it lives (10 min to 7 days) and, optionally, a password.
2. Send the link. Send the password, if any, through another channel.
3. The note is deleted the moment the recipient presses **Reveal**. Opening the link again shows "gone".

## How it stays private

- The note is encrypted in your browser (AES-GCM). The key lives in the part of the link after `#`, which browsers never send to a server, so the server only stores ciphertext.
- Chat previews can't burn the note: nothing is fetched until someone presses Reveal.
- Five wrong passwords destroy the note.
- It can't help if someone intercepts the link before the recipient, or if a corporate mail scanner presses Reveal. For email, use a password.

## Develop

```sh
npm ci
echo 'VITE_SUPABASE_URL=...' > .env.local
echo 'VITE_SUPABASE_ANON_KEY=...' >> .env.local
npm run dev
npm run test:run   # unit tests
npm run test:sql   # SQL tests, needs Docker
```

The backend is `supabase/migrations/0001_behin.sql`.

## License

[MIT](LICENSE)
