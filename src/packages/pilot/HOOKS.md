# Pilot hooks into upstream Orca

Every change Pilot makes to an upstream file is listed here (D24). Each one is an import plus one call, one JSX element, or one config line. The logic lives in `src/packages/pilot/`. `node src/packages/pilot/scripts/hook-guard.mjs` checks that every row's file still contains its Match text, and that no other upstream file differs from `upstream/main`. After an upstream sync, a failing row names the file to fix.

| Hook            | File                        | Match                                   | Why                                                     |
| --------------- | --------------------------- | --------------------------------------- | ------------------------------------------------------- |
| tsconfig-node   | config/tsconfig.node.json   | ../src/packages/pilot/src/main/**/*     | typecheck Pilot main + shared code                      |
| tsconfig-web    | config/tsconfig.web.json    | ../src/packages/pilot/src/renderer/**/* | composite renderer project must list Pilot UI files     |
| tsconfig-tc-web | config/tsconfig.tc.web.json | ../src/packages/pilot/src/renderer/**/* | typecheck config replaces include, so it lists them too |
| tsconfig-cli    | config/tsconfig.cli.json    | ../src/packages/pilot/src/cli/**/*      | CLI compiles Pilot commands                             |
| main            | src/main/startup/main-process-ready-runtime.ts | attachPilotMain(runtime) | start Pilot in desktop/serve before RPC is built |
| orcad           | src/main/orcad/orcad-entry.ts | attachPilotOrcad(runtime, | start Pilot in orcad before RPC binds |
| renderer | src/renderer/src/main.tsx | attachPilotRenderer() | display rebrand + Pilot renderer setup |
| tailwind-source | src/renderer/src/assets/main.css | packages/pilot/src | generate Tailwind classes used by Pilot UI |
