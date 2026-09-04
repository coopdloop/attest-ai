# Changelog

## [0.2.0](https://github.com/coopdloop/attest-ai/compare/v0.1.0...v0.2.0) (2026-09-04)


### Features

* add AGENTS.md, keep pinned sidebar open without slide animation ([430e529](https://github.com/coopdloop/attest-ai/commit/430e52935a2f6cd18ea51f6c10e65495d9e45c8e))
* add Discover page — OpenRouter-style activity log of all model requests ([de99842](https://github.com/coopdloop/attest-ai/commit/de99842c44e02417f91bd833c59e6fc303aaac3c))
* **gateway:** add streaming fix, /v1/models, pi integration, model tests ([1a938b1](https://github.com/coopdloop/attest-ai/commit/1a938b1a5c622eb36f34f30a3f9e40b78099839f))
* link related chat requests into one continuous session ([ff6f5b6](https://github.com/coopdloop/attest-ai/commit/ff6f5b6800989ecec07f2f6ce021279ae5959bd3))
* open trace detail in a slide-over tray from Discover ([268cbd7](https://github.com/coopdloop/attest-ai/commit/268cbd794329047917a6bb5cd35c6dfa17e58b08))
* propagate release version into services and frontend ([67e70ec](https://github.com/coopdloop/attest-ai/commit/67e70ec9fb67617f1216a0600de9e3da1b09c6ea))


### Bug Fixes

* **agent_orchestrator:** forward tool calls and OpenAI params through the gateway ([38fca0d](https://github.com/coopdloop/attest-ai/commit/38fca0d643df0c411da5594e41f09523f2ae65a6))
* **ci:** commit go.sum files so CI can resolve Go modules ([ea8c1b6](https://github.com/coopdloop/attest-ai/commit/ea8c1b6a47ef74310b0751be2c0e42576c06c1ba))
* **ci:** only fail trufflehog on verified secrets to avoid dev-cred noise ([911afa8](https://github.com/coopdloop/attest-ai/commit/911afa8c13cd225eead1a95436221db77cd648d7))
* **ci:** remove duplicate --fail flag from trufflehog extra_args ([281ba1f](https://github.com/coopdloop/attest-ai/commit/281ba1f125b022a0af869ed499cf2fc15957631e))
* **frontend:** sync package-lock with dependency tree so npm ci works ([b76ab97](https://github.com/coopdloop/attest-ai/commit/b76ab973d379823a6ca95242f1c3e9f69f122f00))
* **infra:** generate JWT signing keypair at startup ([44bc62e](https://github.com/coopdloop/attest-ai/commit/44bc62ed00a3a7a5c238c25f07c42a1c601f5de0))
* **services:** remove unused walrus assignments in guardrail checks ([f1bfc66](https://github.com/coopdloop/attest-ai/commit/f1bfc66f546b4a4e7b84912464b8be31a9de911d))
* show API-key sessions in UI and fix trace event persistence ([b0b8384](https://github.com/coopdloop/attest-ai/commit/b0b83841490dc0c2c43373d66f9b9119f095af61))


### Documentation

* commit and push only files changed in-session ([a1d4e34](https://github.com/coopdloop/attest-ai/commit/a1d4e34a150dfb9ddf1fc54591604c8fd033a75d))
* overhaul README with banner, badges, and architecture diagram ([47694e3](https://github.com/coopdloop/attest-ai/commit/47694e3d4a429a8ba0e6d7493e699172cd457683))
* reference product spec repo in README ([6ba4603](https://github.com/coopdloop/attest-ai/commit/6ba460356262af556eed627d936a5a7a00de65a6))
