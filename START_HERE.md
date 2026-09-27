# Start Shelf

**The ready-to-run app is already built. No database, account, or API key is needed for a local test.**

1. Install Node.js 22.16+ (Node 22 or 24).
2. Open a terminal in this `shelf` folder.
3. Run:

```sh
npm start
```

Open **http://localhost:3000** in two separate tabs or browser windows. Enter the first tab's eight-character code on the second, approve the connection, add a file or text, then accept it on the other side.

**To use a real phone and computer:** put the app at a shared HTTPS address. Scanning a `localhost` QR on your phone will not open your computer. Read `docs/DEPLOYMENT.md`; Docker + HTTPS configuration is included. Configure your own TURN server for networks where a direct connection is blocked.

`README.md` is the feature/setup guide. `docs/TEST_REPORT.md` records what was actually tested. `docs/KNOWN_LIMITATIONS.md` lists remaining browser and product constraints.
