# Fairy

Proactive Windows desktop assistant (Electron + TS + React + SQLite + .NET 8 broker).

## Run (dev)
```
export PATH="C:/Users/rishi/tools/node:$PATH"
npm run build
node_modules/electron/dist/electron.exe .
```
Or double-click `node_modules/electron/dist/electron.exe` and pick the Fairy folder.

## Test
```
npm run typecheck
npm run test:unit
npm run test:integration
dotnet run --project native/Fairy.Tests/Fairy.Tests.csproj
```

## Notes
- Cloud-only mode: configure providers in Settings panel (API key handed to broker, never stored raw).
- No local models for now (user directive).
- Full spec: fairyplan.md
