# behin

One-time secret notes. _Behin_ is Basque for "once". Write a note, get a link, and the note is deleted the moment someone opens it.

Live at https://endika.github.io/behin/

## How it works

1. **Create.** The browser generates a random 256-bit key. HKDF-SHA256 turns it into an AES-GCM key and a separate auth token. The note is encrypted in the browser, and the server receives only the ciphertext, the IV, SHA-256(auth token) and SHA-256(gate), where the gate is a third HKDF output derived from the link key alone.
2. **The link.** The link is `https://endika.github.io/behin/#<id>.<key>`, with a trailing `.p` when a password is set. The part after `#` is the fragment: browsers never send it to any server.
3. **Open.** Opening the link fetches nothing. Only when the recipient clicks Reveal does the browser call `open_note`, which runs one SQL `delete ... returning` gated on the hash of the gate and then on the hash of the auth token. The row is read and removed in the same statement.
4. **Password (optional).** The password goes through PBKDF2-SHA256 (600,000 iterations) with a salt derived from the link key, and is mixed into the key material. After 5 wrong tries the note is destroyed.
5. **Expiry.** The sender picks 10 min, 1 h, 1 day or 7 days. Expired notes cannot be opened, and pg_cron purges them every 5 minutes.
6. **Limits.** A note is at most 10,000 bytes (UTF-8). The service holds at most 5,000 live notes.
7. **Languages.** Basque, Spanish, English, Galician and Catalan.

## What it protects and what it doesn't

Protects against:

- The server operator and the database: they only ever hold ciphertext, an IV and a hash. The key never leaves the browser.
- Link preview bots: nothing is fetched until someone clicks Reveal, and preview bots load pages without clicking, so they cannot burn the note.
- Guessing and leaks of the id: the server checks a gate hash derived from the link key, so a guessed or leaked id alone can neither read nor burn the note. A wrong gate never counts as a password attempt.
- Races: concurrent opens of the same note have exactly one winner.

Does not protect against:

- Whoever intercepts the link before the recipient. They can read the note and the recipient will then see "gone". Set a password and send it through another channel.
- The link stays in the recipient's browser history (and synced history) and anywhere it was pasted. If it was opened but not revealed, anyone with access to that browser can still reveal it.
- A compromised GitHub account or repository serving altered JavaScript. You are trusting the code that is served.
- The recipient copying or screenshotting the note after it is revealed.
- Clickjacking. GitHub Pages cannot send `frame-ancestors`, so the app itself refuses to show Reveal when it is framed and offers a link to open it directly instead.

## Verify it yourself

Open the browser devtools, Network tab.

1. Create a note. Inspect the `create_note` request body: it holds base64 blobs (`p_ciphertext`, `p_iv`, `p_auth_hash`, `p_gate_hash`) and a TTL. No plaintext, and the key is not there.
2. Open the generated link in another tab. Apart from the page's own files, no request goes out (none to Supabase) until you click Reveal.
3. Click Reveal and inspect the `open_note` request: it carries the id, a gate and an auth token, not the key.
4. Open the same link again: the note is gone.

Run the tests:

```sh
npm ci
npm run test:run   # unit tests: crypto, link parsing, API client, UI, i18n
npm run test:sql   # needs Docker
```

`test:sql` starts a throwaway Postgres 17, applies the migration and asserts that a note opens exactly once, that five wrong tries destroy it, that a wrong gate never burns a note, that expired notes are gone, that `anon` has no direct access to the table, that the cron job is registered, and that 10,000-byte notes round-trip. It also runs a 50-way concurrent read race (exactly one `ok`) and a wrong-token race (at most 5 `wrong`, and the note ends up deleted).

## Develop

Create `.env.local`:

```sh
VITE_SUPABASE_URL=<your project URL>
VITE_SUPABASE_ANON_KEY=<your anon key>
```

Then `npm run dev`. The backend is the schema in `supabase/migrations/0001_behin.sql`.

Gates: `npm run format:check`, `npm run lint`, `npm run type:check`, `npm run test:run` and `npm run build`.

## License

[MIT](LICENSE)
