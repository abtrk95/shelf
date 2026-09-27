# Start Shelf

Install Node.js 22.16 or newer, then run these commands in the project folder:

```sh
npm ci --include=dev
npm start
```

Open `http://localhost:3000` in two tabs. Enter one tab's eight-character code on the other. They connect immediately; text and files arrive automatically. Tap a text card to read it in full. Use the header Connection button for session details or to disconnect.

Keep the code private and both tabs open. Saving files and opening links still require your action. Refreshing clears the current live shelf, so save anything needed first.

For phone-to-computer use, deploy to the same reachable HTTPS address. Configure a TURN relay for networks that block direct connections. See `docs/DEPLOYMENT.md`; `docs/TEST_REPORT.md` separates executed checks from pending browser validation.
